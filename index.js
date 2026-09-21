import proxy from './proxy.js';
import { handleAdmin, isAdminPath } from './admin.js';
import { clientIP, findEntry, logAccess, safePath } from './access.js';

export default {
  async fetch(request, env, ctx) {
    const started = Date.now();
    const url = new URL(request.url);
    const ip = clientIP(request);
    const admin = isAdminPath(url.pathname);
    let decision = admin ? 'admin' : 'denied';
    let entry;
    let response;

    try {
      if (admin) {
        // Reserved for Cloudflare Access; this namespace bypasses the IP list.
        response = await handleAdmin(request, env, url);
      } else {
        entry = await findEntry(env.DB, ip);
        if (entry?.enabled) {
          decision = 'allowed';
          response = await proxy.fetch(request, env);
        } else {
          response = new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_failed', message: error.message }));
      decision = 'error';
      response = new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    ctx.waitUntil(logAccess(env.DB, {
      ip, entry, decision, path: safePath(url.pathname),
      method: request.method, status: response.status, createdAt: started,
      durationMs: Date.now() - started,
      country: request.cf?.country ?? '',
      userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512),
    }).catch(error => {
      console.error(JSON.stringify({ event: 'access_log_failed', message: error.message }));
    }));
    return response;
  },
};
