// Filled from hosts/ by build.js.
const HOSTS = new Map([/* HOST_HANDLERS */]);
const REQUEST_HEADERS = [
  'accept', 'accept-encoding', 'user-agent', 'range', 'if-range',
  'if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since',
];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const error = (status, message) => new Response(message, { status });

export default {
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const incoming = new URL(request.url);
    const [, host, path = '/'] = incoming.pathname.match(/^\/([^/]+)(\/.*)?$/) ?? [];
    if (!HOSTS.has(host)) return error(403, 'Host not allowed');

    // Assign pathname separately: a path beginning with // must never change the host.
    const target = new URL(`https://${host}`);
    target.pathname = path;
    target.search = incoming.search;
    try {
      return await HOSTS.get(host)({ request, target, proxy });
    } catch {
      return error(502, 'Upstream unavailable');
    }
  },
};

async function proxy(request, target) {
  // Host handlers may rewrite paths, but the transport still enforces the allowlist.
  if (target.protocol !== 'https:' || !HOSTS.has(target.hostname)
    || target.port || target.username || target.password) {
    return error(403, 'Host not allowed');
  }
  const incoming = new URL(request.url);
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }

  const upstream = await fetch(target, { method: request.method, headers, redirect: 'manual' });
  const response = new Response(upstream.body, upstream);
  response.headers.delete('set-cookie');
  if (REDIRECTS.has(response.status) && response.headers.has('location')) {
    const next = new URL(response.headers.get('location'), target);
    if (!['http:', 'https:'].includes(next.protocol) || !HOSTS.has(next.hostname)
      || next.port || next.username || next.password) {
      await response.body?.cancel();
      return error(502, 'Upstream redirect not allowed');
    }
    response.headers.set('location', `${incoming.origin}/${next.hostname}${next.pathname}${next.search}${next.hash}`);
  }
  return response;
}
