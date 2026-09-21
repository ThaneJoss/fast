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
const tags = ['Ubuntu', 'npm', '初始化脚本', '管理后台', '其他路径'];
const decisions = ['allowed', 'denied', 'admin', 'error'];
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
      if (url.pathname === '/admin/api/ips') return json(await overview(env.DB, url.searchParams, true));
      if (url.pathname === '/admin/api/logs') {
        return json(url.searchParams.get('view') === 'events'
          ? await events(env.DB, url.searchParams) : await overview(env.DB, url.searchParams, false));
      }
      fail(404, '接口不存在');
    }
    if (!['POST', 'PUT', 'DELETE'].includes(request.method)) fail(405, '不支持的请求方法');
    // Authentication is delegated to Access; reject cross-origin browser mutations.
    if (request.headers.get('origin') !== url.origin) fail(403, '管理操作必须来自本站');
    if (url.pathname === '/admin/api/ips' && request.method === 'PUT') {
      await saveIP(env.DB, await readJSON(request));
      return json({ ok: true });
    }
    const route = url.pathname.match(/^\/admin\/api\/groups(?:\/([1-9]\d*))?$/);
    if (!route) fail(404, '接口不存在');
    const id = route[1] ? integer(route[1], 1) : null;
    if ((request.method === 'POST') !== (id === null)) fail(405, '不支持的请求方法');
    if (id !== null && !await env.DB.prepare('SELECT id FROM ip_groups WHERE id = ?').bind(id).first()) {
      fail(404, '分组不存在');
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM ip_groups WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    const data = await readJSON(request);
    const name = text(data.name, '分组名称', 80);
    const result = id === null
      ? await env.DB.prepare('INSERT INTO ip_groups (name) VALUES (?)').bind(name).run()
      : await env.DB.prepare('UPDATE ip_groups SET name = ? WHERE id = ?').bind(name, id).run();
    return json({ id: id ?? result.meta.last_row_id }, id === null ? 201 : 200);
  } catch (error) {
    if (error instanceof HTTPError) return json({ error: error.message }, error.status);
    if (/UNIQUE constraint failed/.test(error.message)) return json({ error: '分组名称已存在' }, 409);
    if (/FOREIGN KEY constraint failed/.test(error.message)) return json({ error: '分组已变更，请刷新后重试' }, 409);
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

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label}须为 1–${max} 个字符`);
  return value.trim();
}

function integer(value, min = 0) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min) fail(400, '无效的编号或页码');
  return Number(value);
}

async function saveIP(db, data) {
  const ip = normalizeIP(data.ip);
  if (!ip) fail(400, '无效的 IP 地址');
  // Only observed or previously configured IPs can be managed. Saving metadata never grants access.
  if (!await db.prepare(`SELECT 1 FROM access_logs WHERE ip = ?
    UNION ALL SELECT 1 FROM ip_allowlist WHERE ip = ? LIMIT 1`).bind(ip, ip).first()) {
    fail(404, '该 IP 尚无访问记录');
  }
  const hasEnabled = Object.hasOwn(data, 'enabled');
  const hasGroup = Object.hasOwn(data, 'group_id');
  const hasNote = Object.hasOwn(data, 'note');
  if (!hasEnabled && !hasGroup && !hasNote) fail(400, '缺少要更新的内容');
  if (hasEnabled && typeof data.enabled !== 'boolean') fail(400, '放行状态必须为布尔值');
  const group = hasGroup && data.group_id !== null ? integer(data.group_id, 1) : null;
  if (hasNote && (typeof data.note !== 'string' || data.note.length > 240)) fail(400, '备注不能超过 240 个字符');
  await db.prepare(`INSERT INTO ip_allowlist (ip, group_id, note, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      group_id = CASE WHEN ? THEN excluded.group_id ELSE ip_allowlist.group_id END,
      note = CASE WHEN ? THEN excluded.note ELSE ip_allowlist.note END,
      enabled = CASE WHEN ? THEN excluded.enabled ELSE ip_allowlist.enabled END,
      updated_at = excluded.updated_at`).bind(
    ip, group, hasNote ? data.note.trim() : '', data.enabled === true ? 1 : 0, Date.now(),
    hasGroup ? 1 : 0, hasNote ? 1 : 0, hasEnabled ? 1 : 0,
  ).run();
}

async function state(db, ip) {
  const [groups, summary] = await db.batch([
    db.prepare(`SELECT g.*, count(w.id) AS member_count FROM ip_groups g
      LEFT JOIN ip_allowlist w ON w.group_id = g.id GROUP BY g.id ORDER BY g.id`),
    db.prepare(`SELECT
      (SELECT count(*) FROM (SELECT ip FROM access_logs UNION SELECT ip FROM ip_allowlist)) AS ip_count,
      (SELECT count(*) FROM ip_allowlist WHERE enabled = 1) AS enabled_count,
      (SELECT count(*) FROM access_logs) AS request_count`),
  ]);
  return { ip, groups: groups.results, tags, ...summary.results[0] };
}

async function logFilter(db, params) {
  // Freeze the log boundary while paging; new requests become visible on refresh.
  const snapshot = params.has('snapshot') ? integer(params.get('snapshot'))
    : await db.prepare('SELECT coalesce(max(id), 0) AS id FROM access_logs').first('id');
  const clauses = ['l.id <= ?'];
  const values = [snapshot];
  if (params.get('decision')) {
    if (!decisions.includes(params.get('decision'))) fail(400, '无效的访问结果');
    clauses.push('l.decision = ?'); values.push(params.get('decision'));
  }
  if (params.get('tag')) {
    if (!tags.includes(params.get('tag'))) fail(400, '无效的路径标签');
    clauses.push('l.path_tag = ?'); values.push(params.get('tag'));
  }
  if (params.get('path')) {
    clauses.push('instr(l.path, ?) > 0'); values.push(text(params.get('path'), '路径', 2048));
  }
  const dates = ['from', 'to'].map(key => params.get(key) ? Date.parse(params.get(key)) : null);
  if (dates.some(value => value !== null && !Number.isFinite(value)) || (dates[0] !== null && dates[1] !== null && dates[0] > dates[1])) fail(400, '时间范围无效');
  if (dates[0] !== null) { clauses.push('l.created_at >= ?'); values.push(dates[0]); }
  if (dates[1] !== null) { clauses.push('l.created_at <= ?'); values.push(dates[1]); }
  if (params.has('ip')) {
    const ip = params.get('ip') === '' ? '' : normalizeIP(params.get('ip'));
    if (ip === null) fail(400, '无效的 IP 地址');
    clauses.push('l.ip = ?'); values.push(ip);
  }
  return { snapshot, clauses, values };
}

async function overview(db, params, includeConfigured) {
  const { snapshot, clauses, values } = await logFilter(db, params);
  const page = params.has('page') ? integer(params.get('page'), 1) : 1;
  if (page > 100000) fail(400, '页码过大');
  const filters = [];
  if (params.get('group_id') === 'none') filters.push('group_id IS NULL');
  else if (params.get('group_id')) { filters.push('group_id = ?'); values.push(integer(params.get('group_id'), 1)); }
  if (params.has('enabled')) {
    if (!['0', '1'].includes(params.get('enabled'))) fail(400, '无效的放行状态');
    filters.push('enabled = ?'); values.push(Number(params.get('enabled')));
  }
  if (params.get('q')) {
    filters.push('(instr(lower(ip), lower(?)) > 0 OR instr(lower(note), lower(?)) > 0)');
    const search = text(params.get('q'), '搜索内容', 240); values.push(search, search);
  }
  const query = `WITH matched AS (
      SELECT ip, id, created_at, decision, path_tag FROM access_logs l WHERE ${clauses.join(' AND ')}
    ), totals AS (
      SELECT ip, count(*) AS request_count,
        sum(decision = 'allowed') AS allowed_count, sum(decision = 'denied') AS denied_count,
        sum(decision = 'admin') AS admin_count, sum(decision = 'error') AS error_count,
        max(id) AS latest_id, min(created_at) AS first_seen, max(created_at) AS last_seen,
        json_group_array(DISTINCT path_tag) AS tags
      FROM matched GROUP BY ip
    ), ips AS (
      SELECT ip FROM totals ${includeConfigured ? 'UNION SELECT ip FROM ip_allowlist' : ''}
    ), rows AS (
      SELECT i.ip, coalesce(w.enabled, 0) AS enabled, w.group_id, g.name AS group_name,
        coalesce(w.note, '') AS note, coalesce(t.request_count, 0) AS request_count,
        coalesce(t.allowed_count, 0) AS allowed_count, coalesce(t.denied_count, 0) AS denied_count,
        coalesce(t.admin_count, 0) AS admin_count, coalesce(t.error_count, 0) AS error_count,
        t.first_seen, t.last_seen, coalesce(t.latest_id, 0) AS latest_id, coalesce(t.tags, '[]') AS tags,
        l.path AS latest_path, l.method AS latest_method, l.status AS latest_status
      FROM ips i LEFT JOIN totals t ON t.ip = i.ip
      LEFT JOIN ip_allowlist w ON w.ip = i.ip LEFT JOIN ip_groups g ON g.id = w.group_id
      LEFT JOIN access_logs l ON l.id = t.latest_id
    ) SELECT *, count(*) OVER() AS ip_total, sum(request_count) OVER() AS request_total
      FROM rows ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY latest_id DESC, ip ASC LIMIT 21 OFFSET ?`;
  const { results } = await db.prepare(query).bind(...values, (page - 1) * 20).all();
  return {
    ips: results.slice(0, 20).map(({ ip_total, request_total, ...row }) => ({ ...row, tags: JSON.parse(row.tags) })),
    total: results[0]?.ip_total ?? 0, requests: results[0]?.request_total ?? 0,
    page, next: results.length > 20, snapshot,
  };
}

async function events(db, params) {
  if (!params.has('ip')) fail(400, '请选择要查看的 IP');
  const { snapshot, clauses, values } = await logFilter(db, params);
  if (params.get('before')) { clauses.push('l.id < ?'); values.push(integer(params.get('before'), 1)); }
  const { results } = await db.prepare(`SELECT l.* FROM access_logs l
    WHERE ${clauses.join(' AND ')} ORDER BY l.id DESC LIMIT 51`).bind(...values).all();
  return { logs: results.slice(0, 50), next: results.length > 50 ? results[49].id : null, snapshot };
}
