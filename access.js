import { isIP } from 'node:net';

export function normalizeIP(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version === 6 && !ip.includes('%')) return new URL(`https://[${ip}]/`).hostname.slice(1, -1);
  return null;
}

export function clientIP(request) {
  return normalizeIP(request.headers.get('cf-connecting-ip')) ?? '';
}

export function safePath(pathname) {
  // The proxy accepts /user:password@host/path. Never persist URL credentials or queries.
  return pathname.replace(/^\/[^/]*@([^/]*)/, '/$1').slice(0, 2048);
}

export function findEntry(db, ip) {
  return db.prepare(`SELECT w.*, g.name AS group_name FROM ip_allowlist w
    LEFT JOIN ip_groups g ON g.id = w.group_id WHERE w.ip = ?`).bind(ip).first();
}

export async function logAccess(db, event) {
  const [entry, category] = await Promise.all([
    event.entry === undefined ? findEntry(db, event.ip) : event.entry,
    db.prepare(`SELECT c.id, c.name FROM path_rules r
      JOIN path_categories c ON c.id = r.category_id
      WHERE r.prefix = '/' OR ? = r.prefix OR substr(?, 1, length(r.prefix) + 1) = r.prefix || '/'
      ORDER BY length(r.prefix) DESC LIMIT 1`).bind(event.path, event.path).first(),
  ]);
  await db.prepare(`INSERT INTO access_logs
    (created_at, ip, method, path, status, decision, group_id, group_name,
     category_id, category_name, country, user_agent, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    event.createdAt, event.ip, event.method, event.path, event.status, event.decision,
    entry?.group_id ?? null, entry?.group_name ?? null, category?.id ?? null, category?.name ?? null,
    event.country, event.userAgent, event.durationMs,
  ).run();
}
