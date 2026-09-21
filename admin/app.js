const $ = selector => document.querySelector(selector);
const state = { ip: '', groups: [], whitelist: [], categories: [] };
let tab = 'whitelist';
let cursors = [null];
let page = 0;
let nextCursor = null;
let logQuery = new URLSearchParams();
let logRequest = 0;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function message(text, error = false) {
  const element = $('#message');
  element.textContent = text;
  element.className = error ? 'error' : '';
  element.hidden = !text;
  element.setAttribute('role', error ? 'alert' : 'status');
}

async function perform(work, button) {
  if (button) button.disabled = true;
  try { await work(); }
  catch (error) { message(error.message, true); }
  finally { if (button) button.disabled = false; }
}

async function api(path, method = 'GET', body) {
  const response = await fetch(`/admin/api/${path}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('无法读取管理接口，请刷新页面确认登录状态。');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '请求失败，请重试');
  return data;
}

function options(selector, items, allLabel, emptyLabel) {
  const select = $(selector);
  const current = select.value;
  select.replaceChildren(new Option(allLabel, ''));
  if (emptyLabel) select.add(new Option(emptyLabel, 'none'));
  for (const item of items) select.add(new Option(item.name, String(item.id)));
  select.value = [...select.options].some(option => option.value === current) ? current : '';
}

async function refreshState() {
  Object.assign(state, await api('state'));
  $('#current-ip').textContent = state.ip || '未获取到 IP';
  $('#use-current-ip').disabled = !state.ip;
  $('#enabled-count').textContent = state.whitelist.filter(item => item.enabled).length;
  $('#group-count').textContent = state.groups.length;
  $('#category-count').textContent = state.categories.length;
  options('#entry-group', state.groups, '未分组');
  options('#whitelist-group', state.groups, '全部分组', '未分组');
  options('#log-group', state.groups, '全部分组', '未分组');
  options('#log-category', state.categories, '全部分类', '未分类');
  renderWhitelist();
  renderRules();
}

function showTab(name) {
  tab = name;
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const name of ['whitelist', 'logs', 'categories']) $(`#panel-${name}`).hidden = name !== tab;
  if (tab === 'logs') return loadLogs(0, true);
}

const titles = { whitelist: '添加 IP', group: '添加 IP 分组', category: '添加路径分类' };
function resetForm(name) {
  const form = $(`#${name}-form`);
  form.reset();
  form.elements.id.value = '';
  $(`#${name}-form-title`).textContent = titles[name];
}

function edit(name, item) {
  const form = $(`#${name}-form`);
  resetForm(name);
  for (const [key, value] of Object.entries(item)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = Array.isArray(value) ? value.join('\n') : value ?? '';
  }
  $(`#${name}-form-title`).textContent = `编辑${name === 'whitelist' ? ' IP' : name === 'group' ? ' IP 分组' : '路径分类'}`;
  form.scrollIntoView({ block: 'nearest' });
  form.elements.namedItem(name === 'whitelist' ? 'ip' : 'name').focus();
}

function action(label, work, danger = false) {
  const button = node('button', label, `text-button${danger ? ' danger' : ''}`);
  button.type = 'button';
  button.addEventListener('click', () => perform(work, button));
  return button;
}

async function remove(resource, item, prompt) {
  if (!confirm(prompt)) return;
  await api(`${resource}/${item.id}`, 'DELETE');
  const formName = { groups: 'group', categories: 'category', whitelist: 'whitelist' }[resource];
  if ($(`#${formName}-form`).elements.id.value === String(item.id)) resetForm(formName);
  await refreshState();
  message('已删除');
}

function emptyRow(columns, text) {
  const row = node('tr');
  const cell = node('td', text, 'empty');
  cell.colSpan = columns;
  row.append(cell);
  return row;
}

function renderWhitelist() {
  const search = $('#whitelist-search').value.trim().toLowerCase();
  const group = $('#whitelist-group').value;
  const status = $('#whitelist-status').value;
  const items = state.whitelist.filter(item =>
    (!search || `${item.ip} ${item.note}`.toLowerCase().includes(search)) &&
    (!group || (group === 'none' ? item.group_id === null : String(item.group_id) === group)) &&
    (!status || String(item.enabled) === status));
  $('#whitelist-count').textContent = `${items.length} / ${state.whitelist.length} 个地址`;
  const rows = items.map(item => {
    const row = node('tr');
    const ip = node('td');
    ip.append(node('code', item.ip));
    const group = node('td', item.group_name ?? '未分组');
    if (item.note) group.append(node('span', item.note, 'muted'));
    const status = node('td');
    status.append(node('span', item.enabled ? '启用' : '停用', `badge ${item.enabled ? 'allowed' : ''}`));
    const controls = node('td');
    const actions = node('div', undefined, 'actions');
    actions.append(
      action('编辑', () => edit('whitelist', item)),
      action(item.enabled ? '停用' : '启用', async () => {
        await api(`whitelist/${item.id}`, 'PUT', { ip: item.ip, group_id: item.group_id, note: item.note, enabled: !item.enabled });
        await refreshState();
        message(item.enabled ? 'IP 已停用' : 'IP 已启用');
      }),
      action('删除', () => remove('whitelist', item, `删除 ${item.ip}？删除后该 IP 将无法访问代理。`), true),
    );
    controls.append(actions);
    row.append(ip, group, status, controls);
    return row;
  });
  $('#whitelist-rows').replaceChildren(...(rows.length ? rows : [emptyRow(4, state.whitelist.length ? '没有匹配的 IP' : '还没有白名单 IP，请在表单中添加。')]));
}

function renderRules() {
  for (const [name, resource, items] of [['group', 'groups', state.groups], ['category', 'categories', state.categories]]) {
    const rows = items.map(item => {
      const row = node('li');
      const info = node('div', undefined, 'rule-info');
      info.append(node('strong', item.name));
      if (name === 'group') info.append(node('small', `${item.member_count} 个 IP`));
      else for (const prefix of item.prefixes) info.append(node('code', prefix));
      const controls = node('div', undefined, 'actions');
      controls.append(
        action('编辑', () => edit(name, item)),
        action('删除', () => remove(resource, item, name === 'group'
          ? `删除分组“${item.name}”？其中的 IP 会移至“未分组”，启用状态保持不变。`
          : `删除分类“${item.name}”及其路径规则？历史日志保留原分类。`), true),
      );
      row.append(info, controls);
      return row;
    });
    $(`#${name}-list`).replaceChildren(...(rows.length ? rows : [node('li', '暂无分类，请先添加。', 'muted')]));
  }
}

const decisions = { allowed: '放行', denied: '拒绝', admin: '管理请求', error: '异常' };
function renderLogs(logs) {
  const rows = logs.map(item => {
    const row = node('tr');
    const source = node('td', new Date(item.created_at).toLocaleString('zh-CN', { hour12: false }));
    source.append(node('span', item.ip || '未知 IP', 'muted mono'));
    if (item.country) source.append(node('span', item.country, 'muted'));
    const request = node('td');
    request.append(node('span', item.method, 'badge'), node('code', item.path, 'request-path'));
    if (item.user_agent) {
      const detail = node('details');
      detail.append(node('summary', '客户端', 'muted'), node('span', item.user_agent, 'muted'));
      request.append(detail);
    }
    const category = node('td', item.group_name ?? '未分组');
    category.append(node('span', item.category_name ?? '未分类', 'muted'));
    const status = node('td');
    status.append(node('span', decisions[item.decision], `badge ${item.decision}`), node('span', String(item.status), 'muted mono'));
    row.append(source, request, category, status, node('td', `${item.duration_ms} ms`, 'muted'));
    return row;
  });
  $('#log-rows').replaceChildren(...(rows.length ? rows : [emptyRow(5, '当前条件下没有访问记录')]));
}

async function loadLogs(targetPage = 0, reset = false) {
  const requestId = ++logRequest;
  const params = new URLSearchParams(logQuery);
  if (!reset && cursors[targetPage]) params.set('before', cursors[targetPage]);
  $('#previous-page').disabled = true;
  $('#next-page').disabled = true;
  $('#log-page-info').textContent = '正在读取日志…';
  try {
    const result = await api(`logs?${params}`);
    if (requestId !== logRequest) return;
    if (reset) cursors = [null];
    page = targetPage;
    nextCursor = result.next;
    renderLogs(result.logs);
    $('#log-page-info').textContent = `第 ${page + 1} 页 · ${result.logs.length} 条记录`;
  } catch (error) {
    if (requestId !== logRequest) return;
    $('#log-page-info').textContent = '加载失败，请重试';
    throw error;
  } finally {
    if (requestId === logRequest) {
      $('#previous-page').disabled = page === 0;
      $('#next-page').disabled = nextCursor === null;
    }
  }
}

for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => perform(() => showTab(button.dataset.tab)));
for (const button of document.querySelectorAll('[data-reset]')) button.addEventListener('click', () => resetForm(button.dataset.reset));
for (const selector of ['#whitelist-search', '#whitelist-group', '#whitelist-status']) $(selector).addEventListener('input', renderWhitelist);

for (const [name, resource] of [['whitelist', 'whitelist'], ['group', 'groups'], ['category', 'categories']]) {
  const form = $(`#${name}-form`);
  form.addEventListener('submit', event => {
    event.preventDefault();
    perform(async () => {
      const data = Object.fromEntries(new FormData(form));
      const id = data.id;
      delete data.id;
      if (name === 'whitelist') {
        data.group_id = data.group_id ? Number(data.group_id) : null;
        data.enabled = form.elements.enabled.checked;
      }
      if (name === 'category') data.prefixes = data.prefixes.split('\n').map(line => line.trim()).filter(Boolean);
      await api(id ? `${resource}/${id}` : resource, id ? 'PUT' : 'POST', data);
      resetForm(name);
      await refreshState();
      message('已保存');
    }, form.querySelector('[type="submit"]'));
  });
}

$('#use-current-ip').addEventListener('click', () => {
  showTab('whitelist');
  resetForm('whitelist');
  $('#whitelist-form').elements.ip.value = state.ip;
  $('#whitelist-form').elements.ip.focus();
});
$('#refresh').addEventListener('click', event => perform(async () => {
  await refreshState();
  if (tab === 'logs') await loadLogs(0, true);
  message('数据已刷新');
}, event.currentTarget));
$('#log-filters').addEventListener('submit', event => {
  event.preventDefault();
  perform(async () => {
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(event.target)) {
      if (value) query.set(key, ['from', 'to'].includes(key) ? new Date(value).toISOString() : value.trim());
    }
    logQuery = query;
    await loadLogs(0, true);
    message('');
  }, event.submitter);
});
$('#log-filters').addEventListener('reset', () => {
  logQuery = new URLSearchParams();
  perform(() => loadLogs(0, true));
});
$('#previous-page').addEventListener('click', () => perform(() => loadLogs(page - 1)));
$('#next-page').addEventListener('click', () => {
  cursors[page + 1] = nextCursor;
  perform(() => loadLogs(page + 1));
});
perform(refreshState);
