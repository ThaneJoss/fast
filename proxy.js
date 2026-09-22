import home from './home.js';
import archive from './hosts/archive.ubuntu.com';
import security from './hosts/security.ubuntu.com';
import npm from './hosts/registry.npmjs.org';

const HOSTS = new Map([
  ['archive.ubuntu.com', archive],
  ['security.ubuntu.com', security],
  ['registry.npmjs.org', npm],
]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const error = status => new Response(null, { status });

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname === '/') return home(request, env);
    const [, authority, path = '/'] = incoming.pathname.match(/^\/([^/]+)(\/.*)?$/) ?? [];
    const target = URL.parse(`https://${authority}`);
    if (!target || !HOSTS.has(target.hostname)) return error(403);

    // Assign pathname separately: a path beginning with // must never change the host.
    target.pathname = path;
    target.search = incoming.search;
    try {
      return await HOSTS.get(target.hostname)({ request, target, proxy });
    } catch {
      return error(502);
    }
  },
};

async function proxy(request, target) {
  // Host handlers may rewrite paths, but the transport still enforces the allowlist.
  if (target.protocol !== 'https:' || !HOSTS.has(target.hostname)) {
    return error(403);
  }
  const incoming = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set('host', target.host);

  const upstream = await fetch(target, { method: request.method, headers, body: request.body, redirect: 'manual' });
  const response = new Response(upstream.body, upstream);
  if (REDIRECTS.has(response.status) && response.headers.has('location')) {
    const next = new URL(response.headers.get('location'), target);
    if (!['http:', 'https:'].includes(next.protocol) || !HOSTS.has(next.hostname)) {
      await response.body?.cancel();
      return error(502);
    }
    response.headers.set('location', proxyURL(incoming.origin, next));
  }
  if (response.status !== 206 && /^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    response.headers.delete('content-length');
    response.headers.delete('etag');
    if (!response.body) return response;

    const rewriter = new HTMLRewriter();
    for (const attribute of ['href', 'src']) {
      rewriter.on(`[${attribute}]`, {
        element(element) {
          const value = element.getAttribute(attribute).trim();
          if (!/^(\/|https?:\/\/)/i.test(value)) return;

          const next = URL.parse(value, target.href);
          if (!next || !['http:', 'https:'].includes(next.protocol) || !HOSTS.has(next.hostname)) return;

          element.setAttribute(attribute, proxyURL(incoming.origin, next));
        },
      });
    }
    return rewriter.transform(response);
  }
  return response;
}

function proxyURL(origin, target) {
  return `${origin}/${target.href.slice(target.protocol.length + 2)}`;
}
