import archive from '../hosts/archive.ubuntu.com';
import security from '../hosts/security.ubuntu.com';

const HOSTS = new Map([
  ['archive.ubuntu.com', archive],
  ['security.ubuntu.com', security],
]);
const REQUEST_HEADERS = [
  'accept', 'accept-encoding', 'user-agent', 'range', 'if-range',
  'if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since',
];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const error = status => new Response(null, { status });

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const [, host, path = '/'] = incoming.pathname.match(/^\/([^/]+)(\/.*)?$/) ?? [];
    if (!HOSTS.has(host)) return error(403);

    // Assign pathname separately: a path beginning with // must never change the host.
    const target = new URL(`https://${host}`);
    target.pathname = path;
    target.search = incoming.search;
    try {
      return await HOSTS.get(host)({ request, target, proxy });
    } catch {
      return error(502);
    }
  },
};

async function proxy(request, target) {
  // Host handlers may rewrite paths, but the transport still enforces the allowlist.
  if (target.protocol !== 'https:' || !HOSTS.has(target.hostname)
    || target.port || target.username || target.password) {
    return error(403);
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
      return error(502);
    }
    response.headers.set('location', `${incoming.origin}/${next.hostname}${next.pathname}${next.search}${next.hash}`);
  }
  return response;
}
