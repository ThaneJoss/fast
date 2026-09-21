const $ = selector => document.querySelector(selector);
const formatNumber = value => Number(value).toLocaleString('zh-CN');
const formatTime = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
const decisionLabels = { allowed: '放行', denied: '拒绝', admin: '管理请求', error: '异常' };
const newView = () => ({ filters: {}, page: 1, snapshot: null, next: false });
const views = { ips: newView(), logs: newView() };
let state = { ip: '', groups: [], tags: [] };
let activeTab = 'ips';
let listRequest = 0;
let detailId = 0;
let editingIP = null;
let editingGroup = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label, action, className = 'button') {
  const node = element('button', label, className);
  node.type = 'button';
  node.addEventListener('click', () => run(node, action));
  return node;
}

function message(text, error = false) {
  $('#message').textContent = text;
  $('#message').hidden = !text;
  $('#message').classList.toggle('error', error);
}

async function run(control, action) {
  control.disabled = true;
  try { await action(); }
  catch (error) { message(error.message, true); }
  finally { control.disabled = false; }
}

async function api(path, method = 'GET', data) {
  const response = await fetch('/admin/api/' + path, {
    method, credentials: 'same-origin',
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('登录状态已变化，请刷新页面后重试。');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败，请重试。');
  return result;
}

function options(container, items, selected, onChange) {
  container.replaceChildren(...items.map(([value, label]) => {
    const node = button(label, async () => {
      const pending = onChange(value);
      container.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      await pending;
    }, 'option');
    node.setAttribute('aria-pressed', String(String(value) === String(selected)));
    return node;
  }));
}

function groupOptions(all = true) {
  return [...(all ? [['', '全部']] : []), ['none', '未分组'], ...state.groups.map(group => [String(group.id), group.name])];
}

function renderFilters() {
  if (activeTab === 'groups') return;
  const view = views[activeTab];
  const filter = (id, name, items) => options($(id), items, view.filters[name] ?? '', async value => {
    view.filters[name] = value;
    captureSearch();
    resetPage(view);
    renderFilters();
    await loadOverview();
  });
  filter('#filter-enabled', 'enabled', [['', '全部'], ['1', '已放行'], ['0', '未放行']]);
  filter('#filter-group', 'group_id', groupOptions());
  filter('#filter-tag', 'tag', [['', '全部'], ...state.tags.map(tag => [tag, tag])]);
  filter('#filter-decision', 'decision', [['', '全部'], ...Object.entries(decisionLabels)]);
  filter('#filter-period', 'period', [['', '全部时间'], ['1', '最近 24 小时'], ['7', '最近 7 天'], ['30', '最近 30 天']]);
  $('#search').value = view.filters.q ?? '';
  $('#search-path').value = view.filters.path ?? '';
}

function captureSearch() {
  const filters = views[activeTab].filters;
  filters.q = $('#search').value.trim();
  if (activeTab === 'logs') filters.path = $('#search-path').value.trim();
}

function resetPage(view) {
  view.page = 1;
  view.snapshot = null;
  // Keep this boundary fixed for the whole pagination session.
  view.from = view.filters.period ? new Date(Date.now() - Number(view.filters.period) * 86400000).toISOString() : null;
}

function parameters(view) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(view.filters)) {
    if (key !== 'period' && value !== '') params.set(key, value);
  }
  if (view.from) params.set('from', view.from);
  if (view.snapshot !== null) params.set('snapshot', view.snapshot);
  params.set('page', view.page);
  return params;
}

async function loadState() {
  state = await api('state');
  $('#ip-count').textContent = formatNumber(state.ip_count);
  $('#enabled-count').textContent = formatNumber(state.enabled_count);
  $('#request-count').textContent = formatNumber(state.request_count);
  $('#current-ip').textContent = state.ip || '未知 IP';
  $('#group-count').textContent = `${state.groups.length} 个分组`;
  // Deleted groups no longer participate in current-IP filtering.
  for (const view of Object.values(views)) {
    if (view.filters.group_id && view.filters.group_id !== 'none' && !state.groups.some(group => String(group.id) === view.filters.group_id)) {
      delete view.filters.group_id;
      resetPage(view);
    }
  }
  renderFilters();
  renderGroups();
}

async function refresh() {
  await loadState();
  if (activeTab !== 'groups') { resetPage(views[activeTab]); await loadOverview(); }
}

async function showTab(tab) {
  activeTab = tab;
  listRequest++;
  document.querySelectorAll('[data-tab]').forEach(node => {
    if (node.dataset.tab === tab) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  $('#panel-overview').hidden = tab === 'groups';
  $('#panel-groups').hidden = tab !== 'groups';
  if (tab === 'groups') return;
  const logs = tab === 'logs';
  $('#overview-heading').textContent = logs ? '访问日志' : 'IP 管理';
  $('#overview-label').textContent = logs ? 'REQUEST LOGS' : 'IP OVERVIEW';
  $('#overview-description').textContent = logs ? '按 IP 汇总访问，展开卡片查看每次请求。' : '每个来访 IP 汇总为一张卡片，可直接放行或分组。';
  $('#overview-hint').textContent = logs ? '路径自动标记为 Ubuntu、npm、初始化脚本、管理后台或其他路径。耗时统计到响应头返回。' : '尚无访问记录的已配置 IP 也会保留在此处。';
  $('#ip-list').classList.toggle('log-view', logs);
  document.querySelectorAll('[data-log-filter]').forEach(node => { node.hidden = !logs; });
  renderFilters();
  await loadOverview();
}

async function loadOverview() {
  if (activeTab === 'groups') return;
  const tab = activeTab;
  const view = views[tab];
  const request = ++listRequest;
  $('#ip-list').setAttribute('aria-busy', 'true');
  $('#ip-list').replaceChildren(element('p', '正在读取访问记录…', 'empty'));
  $('#previous-page').disabled = true;
  $('#next-page').disabled = true;
  try {
    const result = await api(`${tab}?${parameters(view)}`);
    if (request !== listRequest) return;
    view.snapshot = result.snapshot;
    view.next = result.next;
    $('#result-count').textContent = `${formatNumber(result.total)} 个 IP · ${formatNumber(result.requests)} 次访问`;
    $('#page-info').textContent = `第 ${view.page} 页 · 每页 20 个 IP`;
    const query = parameters(view);
    $('#ip-list').replaceChildren(...(result.ips.length ? result.ips.map(row => ipCard(row, query)) : [
      element('p', '没有符合条件的 IP。可重置筛选，或在有新访问后刷新。', 'empty'),
    ]));
    $('#previous-page').disabled = view.page === 1;
    $('#next-page').disabled = !view.next;
  } catch (error) {
    if (request !== listRequest) return;
    $('#ip-list').replaceChildren(element('p', '读取失败，请点击“刷新数据”重试。', 'empty'));
    $('#result-count').textContent = '读取失败';
    message(error.message, true);
  } finally {
    if (request === listRequest) $('#ip-list').setAttribute('aria-busy', 'false');
  }
}

function ipCard(row, query) {
  const card = element('article', undefined, 'surface-card ip-card');
  const summary = element('div', undefined, 'ip-summary');
  const heading = element('div', undefined, 'ip-heading');
  const identity = element('div');
  const title = element('h3', undefined, 'ip-address');
  title.append(element('code', row.ip || '未知 IP'));
  identity.append(title);
  const profile = element('div', undefined, 'ip-profile');
  profile.append(element('span', row.group_name || '未分组', 'tag'));
  if (row.ip && row.ip === state.ip) profile.append(element('span', '当前 IP', 'tag path-tag'));
  identity.append(profile);
  heading.append(identity, element('span', row.enabled ? '已放行' : '未放行', 'status' + (row.enabled ? ' allowed' : '')));
  summary.append(heading);
  if (row.note) summary.append(element('p', row.note, 'ip-note'));
  const metrics = element('dl', undefined, 'ip-metrics');
  for (const [key, label] of [['request', '访问'], ['allowed', '放行'], ['denied', '拒绝'], ['admin', '管理'], ['error', '异常']]) {
    const metric = element('div', undefined, 'metric-' + key);
    metric.append(element('dt', label), element('dd', formatNumber(row[key + '_count'])));
    metrics.append(metric);
  }
  summary.append(metrics);
  if (row.tags.length) {
    const tags = element('div', undefined, 'ip-tags');
    tags.setAttribute('aria-label', '访问路径标签');
    tags.append(...row.tags.map(tag => element('span', tag, 'tag path-tag')));
    summary.append(tags);
  }
  card.append(summary);
  const latest = element('p', row.last_seen ? `最近访问 · ${formatTime(row.last_seen)}` : '暂无访问记录', 'latest-request');
  if (row.latest_path) latest.append(element('code', `${row.latest_method} ${row.latest_path}`, 'latest-path'));
  card.append(latest);
  const actions = element('div', undefined, 'actions card-actions');
  if (row.ip) {
    const toggle = button(row.enabled ? '取消放行' : '放行 IP', async () => {
      await api('ips', 'PUT', { ip: row.ip, enabled: !row.enabled });
      await refresh();
      message(`${row.ip} ${row.enabled ? '已取消放行' : '已放行'}`);
    }, 'button' + (row.enabled ? '' : ' primary'));
    toggle.setAttribute('aria-label', `${row.enabled ? '取消放行' : '放行 IP'} ${row.ip}`);
    actions.append(toggle, button('分组与备注', () => openEditor(row)));
  }
  const panel = element('div');
  panel.id = `events-${++detailId}`;
  panel.hidden = true;
  let loaded = false;
  let before = null;
  const entries = element('ol', undefined, 'event-list');
  entries.setAttribute('aria-label', `${row.ip || '未知 IP'} 的请求明细`);
  const errorText = element('p', undefined, 'hint error-text');
  errorText.setAttribute('role', 'status');
  const more = button('加载更早记录', () => loadEvents());
  more.hidden = true;
  const controls = element('div', undefined, 'event-controls');
  controls.append(more);
  panel.append(entries, errorText, controls);
  async function loadEvents() {
    panel.setAttribute('aria-busy', 'true');
    errorText.textContent = '正在读取请求明细…';
    const params = new URLSearchParams(query);
    params.set('view', 'events');
    params.set('ip', row.ip);
    if (before) params.set('before', before);
    try {
      const result = await api(`logs?${params}`);
      entries.append(...result.logs.map(eventRow));
      loaded = true;
      before = result.next;
      more.hidden = !before;
      more.textContent = '加载更早记录';
      errorText.textContent = entries.childElementCount ? '' : '暂无符合筛选条件的请求。';
    } catch (error) {
      errorText.textContent = error.message;
      more.textContent = '重试读取';
      more.hidden = false;
    } finally { panel.setAttribute('aria-busy', 'false'); }
  }
  const expand = button('查看记录', async () => {
    panel.hidden = !panel.hidden;
    expand.setAttribute('aria-expanded', String(!panel.hidden));
    expand.textContent = panel.hidden ? '查看记录' : '收起记录';
    if (!panel.hidden && !loaded) await loadEvents();
  }, 'button subtle');
  expand.setAttribute('aria-expanded', 'false');
  expand.setAttribute('aria-controls', panel.id);
  if (row.request_count) actions.append(expand);
  card.append(actions, panel);
  return card;
}

function eventRow(log) {
  const row = element('li', undefined, 'event');
  const heading = element('div', undefined, 'event-heading');
  const time = element('time', formatTime(log.created_at));
  time.dateTime = new Date(log.created_at).toISOString();
  heading.append(time, element('span', log.path_tag, 'tag path-tag'), element('span', decisionLabels[log.decision], 'status ' + log.decision), element('span', `HTTP ${log.status}`, 'tag'));
  const meta = element('div', undefined, 'event-meta');
  meta.append(element('span', `${log.duration_ms} ms`), element('span', `访问时分组：${log.group_name || '未分组'}`));
  if (log.country) meta.append(element('span', log.country));
  if (log.user_agent) meta.append(element('span', log.user_agent));
  row.append(heading, element('code', `${log.method} ${log.path}`, 'event-path'), meta);
  return row;
}

function renderEditorGroups() {
  options($('#editor-groups'), groupOptions(false), editingGroup ?? 'none', value => {
    editingGroup = value === 'none' ? null : Number(value);
    renderEditorGroups();
  });
}

function openEditor(row) {
  editingIP = row.ip;
  editingGroup = row.group_id;
  $('#editor-ip').textContent = row.ip;
  $('#ip-form').elements.note.value = row.note;
  $('#editor-error').hidden = true;
  renderEditorGroups();
  $('#ip-editor').showModal();
}

function renderGroups() {
  $('#group-list').replaceChildren(...(state.groups.length ? state.groups.map(group => {
    const card = element('article', undefined, 'surface-card group-card');
    const description = element('div');
    description.append(element('h3', group.name), element('p', `${formatNumber(group.member_count)} 个 IP`, 'muted'));
    const actions = element('div', undefined, 'actions');
    actions.append(button('编辑', () => {
      $('#group-form').elements.id.value = group.id;
      $('#group-form').elements.name.value = group.name;
      $('#group-form-title').textContent = '编辑分组';
      $('#group-form').elements.name.focus();
    }), button('删除', async () => {
      if (!confirm(`删除“${group.name}”？其中的 IP 将移至未分组，访问权限保持不变。`)) return;
      await api(`groups/${group.id}`, 'DELETE');
      if ($('#group-form').elements.id.value === String(group.id)) resetGroupForm();
      await loadState();
      message('分组已删除');
    }, 'button subtle danger'));
    card.append(description, actions);
    return card;
  }) : [element('p', '还没有分组。创建一个，开始整理访问来源。', 'empty')]));
}

function resetGroupForm() {
  $('#group-form').reset();
  $('#group-form').elements.id.value = '';
  $('#group-form-title').textContent = '新建分组';
}

$('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  captureSearch(); resetPage(views[activeTab]);
  loadOverview();
});
$('#reset-filters').addEventListener('click', () => {
  views[activeTab] = newView();
  renderFilters(); loadOverview();
});
$('#previous-page').addEventListener('click', () => { views[activeTab].page--; loadOverview(); });
$('#next-page').addEventListener('click', () => { views[activeTab].page++; loadOverview(); });
$('#refresh').addEventListener('click', () => run($('#refresh'), async () => { message(''); await refresh(); }));
document.querySelectorAll('[data-tab]').forEach(node => node.addEventListener('click', () => showTab(node.dataset.tab)));
$('#cancel-group').addEventListener('click', resetGroupForm);
$('#group-form').addEventListener('submit', event => {
  event.preventDefault();
  run(event.submitter, async () => {
    const form = event.currentTarget;
    const id = form.elements.id.value;
    await api('groups' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', { name: form.elements.name.value });
    resetGroupForm();
    await loadState();
    message('分组已保存');
  });
});
$('#ip-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  $('#editor-error').hidden = true;
  try {
    await api('ips', 'PUT', { ip: editingIP, group_id: editingGroup, note: $('#ip-form').elements.note.value });
    $('#ip-editor').close();
    await refresh();
    message('分组与备注已保存');
  } catch (error) {
    $('#editor-error').textContent = error.message;
    $('#editor-error').hidden = false;
    if (!$('#ip-editor').open) message(error.message, true);
  } finally { submit.disabled = false; }
});
for (const id of ['#close-editor', '#cancel-editor']) $(id).addEventListener('click', () => $('#ip-editor').close());
refresh().catch(error => message(error.message, true));
