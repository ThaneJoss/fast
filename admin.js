import html from './admin/index.html';
import css from './admin/style.css';
import script from './admin/app.js';
import { clientIP, normalizeIP } from './access.js';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const assets = new Map([
  ['/admin', [html, 'text/html']], ['/admin/', [html, 'text/html']],
  ['/admin/style.css', [css, 'text/css']], ['/admin/app.js', [script, 'text/javascript']],
]);
const json = (value, status = 200) => Response.json(value, { status, headers });

class HTTPError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HTTPError(status, message); };

export const isAdminPath = path => path === '/admin' || path.startsWith('/admin/');

export async function handleAdmin(request, env, url) {
  try {
    const asset = assets.get(url.pathname);
    if (asset) {
      if (!['GET', 'HEAD'].includes(request.method)) fail(405, '不支持的请求方法');
      return new Response(request.method === 'HEAD' ? null : asset[0], {
        headers: { ...headers, 'Content-Type': `${asset[1]}; charset=utf-8` },
      });
    }
    if (!url.pathname.startsWith('/admin/api/')) fail(404, '页面不存在');
    if (request.method === 'GET') {
      if (url.pathname === '/admin/api/state') return json(await state(env.DB, clientIP(request)));
      if (url.pathname === '/admin/api/logs') return json(await logs(env.DB, url.searchParams));
      fail(404, '接口不存在');
    }
    if (!['POST', 'PUT', 'DELETE'].includes(request.method)) fail(405, '不支持的请求方法');
    // Authentication is delegated to Access; reject cross-origin browser mutations.
    if (request.headers.get('origin') !== url.origin) fail(403, '管理操作必须来自本站');
    const route = url.pathname.match(/^\/admin\/api\/(groups|whitelist|categories)(?:\/([1-9]\d*))?$/);
    if (!route) fail(404, '接口不存在');
    const [, resource, rawId] = route;
    const id = rawId ? positiveInteger(rawId) : null;
    if ((request.method === 'POST') !== (id === null)) fail(405, '不支持的请求方法');
    const tables = { groups: 'ip_groups', whitelist: 'ip_allowlist', categories: 'path_categories' };
    if (id !== null) {
      const existing = await env.DB.prepare(`SELECT id FROM ${tables[resource]} WHERE id = ?`).bind(id).first();
      if (!existing) fail(404, '记录不存在');
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare(`DELETE FROM ${tables[resource]} WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }
    const data = await readJSON(request);
    const savedId = await save(env.DB, resource, id, data);
    return json({ id: savedId }, id === null ? 201 : 200);
  } catch (error) {
    if (error instanceof HTTPError) return json({ error: error.message }, error.status);
    if (/UNIQUE constraint failed/.test(error.message)) return json({ error: 'IP、分类名称或路径前缀已存在' }, 409);
    if (/FOREIGN KEY constraint failed/.test(error.message)) return json({ error: '分组或分类已变更，请刷新后重试' }, 409);
    console.error(JSON.stringify({ event: 'admin_failed', message: error.message }));
    return json({ error: '数据库操作失败，请稍后重试' }, 503);
  }
}

async function readJSON(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) fail(415, '请使用 JSON 请求');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '缺少请求内容');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); fail(413, '请求内容过大'); }
    chunks.push(value);
  }
  let data;
  try { data = JSON.parse(await new Blob(chunks).text()); }
  catch { fail(400, 'JSON 格式错误'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, '请求内容必须是对象');
  return data;
}

function text(value, label, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label}须为 1–${max} 个字符`);
  return value.trim();
}

function positiveInteger(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400, '无效的记录编号');
  return Number(value);
}

function prefixes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) fail(400, '请填写 1–50 个路径前缀');
  return [...new Set(value.map(item => {
    const path = text(item, '路径前缀', 512);
    if (!path.startsWith('/') || path.startsWith('//') || /[?#\\\s]/.test(path)) fail(400, '路径前缀须以 / 开头，且不含空白、查询参数或锚点');
    const normalized = new URL(path, 'https://fast.invalid').pathname;
    return normalized.replace(/\/+$/, '') || '/';
  }))];
}

async function save(db, resource, id, data) {
  if (resource === 'groups') {
    const name = text(data.name, '分组名称');
    const result = id === null
      ? await db.prepare('INSERT INTO ip_groups (name) VALUES (?)').bind(name).run()
      : await db.prepare('UPDATE ip_groups SET name = ? WHERE id = ?').bind(name, id).run();
    return id ?? result.meta.last_row_id;
  }
  if (resource === 'whitelist') {
    const ip = normalizeIP(data.ip);
    if (!ip) fail(400, '请输入完整的 IPv4 或 IPv6 地址');
    const group = data.group_id == null ? null : positiveInteger(data.group_id);
    const note = data.note ?? '';
    if (typeof note !== 'string' || note.length > 240) fail(400, '备注不能超过 240 个字符');
    if (data.enabled !== undefined && typeof data.enabled !== 'boolean') fail(400, '启用状态必须为布尔值');
    const enabled = data.enabled === false ? 0 : 1;
    const result = id === null
      ? await db.prepare('INSERT INTO ip_allowlist (ip, group_id, note, enabled) VALUES (?, ?, ?, ?)').bind(ip, group, note.trim(), enabled).run()
      : await db.prepare('UPDATE ip_allowlist SET ip = ?, group_id = ?, note = ?, enabled = ?, updated_at = ? WHERE id = ?')
        .bind(ip, group, note.trim(), enabled, Date.now(), id).run();
    return id ?? result.meta.last_row_id;
  }
  const name = text(data.name, '分类名称');
  const paths = prefixes(data.prefixes);
  const statements = [id === null
    ? db.prepare('INSERT INTO path_categories (name) VALUES (?)').bind(name)
    : db.prepare('UPDATE path_categories SET name = ? WHERE id = ?').bind(name, id)];
  if (id !== null) statements.push(db.prepare('DELETE FROM path_rules WHERE category_id = ?').bind(id));
  statements.push(db.prepare(`INSERT INTO path_rules (prefix, category_id)
    SELECT value, (SELECT id FROM path_categories WHERE name = ?) FROM json_each(?)`).bind(name, JSON.stringify(paths)));
  const result = await db.batch(statements);
  return id ?? result[0].meta.last_row_id;
}

async function state(db, ip) {
  const [groups, whitelist, categories, rules] = await db.batch([
    db.prepare(`SELECT g.*, count(w.id) AS member_count FROM ip_groups g
      LEFT JOIN ip_allowlist w ON w.group_id = g.id GROUP BY g.id ORDER BY g.id`),
    db.prepare(`SELECT w.*, g.name AS group_name FROM ip_allowlist w
      LEFT JOIN ip_groups g ON w.group_id = g.id ORDER BY w.id DESC`),
    db.prepare('SELECT * FROM path_categories ORDER BY id'),
    db.prepare('SELECT * FROM path_rules ORDER BY prefix'),
  ]);
  return {
    ip, groups: groups.results, whitelist: whitelist.results,
    categories: categories.results.map(category => ({
      ...category, prefixes: rules.results.filter(rule => rule.category_id === category.id).map(rule => rule.prefix),
    })),
  };
}

async function logs(db, params) {
  const where = [];
  const values = [];
  const add = (clause, value) => { where.push(clause); values.push(value); };
  if (params.get('before')) add('id < ?', positiveInteger(params.get('before')));
  if (params.get('ip')) {
    const ip = normalizeIP(params.get('ip'));
    if (!ip) fail(400, '请输入完整的 IPv4 或 IPv6 地址');
    add('ip = ?', ip);
  }
  for (const key of ['group_id', 'category_id']) {
    const value = params.get(key);
    if (value === 'none') where.push(`${key} IS NULL`);
    else if (value) add(`${key} = ?`, positiveInteger(value));
  }
  if (params.get('decision')) {
    const decision = params.get('decision');
    if (!['allowed', 'denied', 'admin', 'error'].includes(decision)) fail(400, '无效的访问结果');
    add('decision = ?', decision);
  }
  if (params.get('path')) add('instr(path, ?) > 0', text(params.get('path'), '路径', 2048));
  const from = params.get('from') ? Date.parse(params.get('from')) : null;
  const to = params.get('to') ? Date.parse(params.get('to')) : null;
  if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)) || (from !== null && to !== null && from > to)) fail(400, '时间范围无效');
  if (from !== null) add('created_at >= ?', from);
  if (to !== null) add('created_at <= ?', to);
  const { results } = await db.prepare(`SELECT * FROM access_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 51`).bind(...values).all();
  return { logs: results.slice(0, 50), next: results.length > 50 ? results[49].id : null };
}
