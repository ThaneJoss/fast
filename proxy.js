import home from './home.js';
import archive from './hosts/archive.ubuntu.com';
import security from './hosts/security.ubuntu.com';
import npm from './hosts/registry.npmjs.org';
import github from './hosts/github.com';
import nvm from './hosts/raw.githubusercontent.com';
import node from './hosts/nodejs.org';

const HOSTS = new Map([
  ['archive.ubuntu.com', archive],
  ['security.ubuntu.com', security],
  ['registry.npmjs.org', npm],
]);
// Keep the legacy transport's allowlist separate from anonymous download routes.
const PUBLIC_HOSTS = new Map([
  ['github.com', github],
  ['raw.githubusercontent.com', nvm],
  ['nodejs.org', node],
]);
const PUBLIC_HEADERS = [
  'accept', 'accept-encoding', 'user-agent', 'git-protocol',
  'content-type', 'content-encoding', 'range', 'if-range',
  'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since',
  'cache-control',
];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const error = status => new Response(null, { status });

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname === '/') return home(request, env);
    const [, authority, path = '/'] = incoming.pathname.match(/^\/([^/]+)(\/.*)?$/) ?? [];
    const target = URL.parse(`https://${authority}`);
    if (!target || (!HOSTS.has(target.hostname) && !PUBLIC_HOSTS.has(target.hostname))) return error(403);
    // Public routes accept a literal hostname, never userinfo, ports or encoded hosts.
    if (PUBLIC_HOSTS.has(target.hostname) && authority !== target.hostname) return error(403);

    // Assign pathname separately: a path beginning with // must never change the host.
    target.pathname = path;
    target.search = incoming.search;
    try {
      if (PUBLIC_HOSTS.has(target.hostname)) {
        return await PUBLIC_HOSTS.get(target.hostname)({ request, target, proxy: publicProxy });
      }
      return await HOSTS.get(target.hostname)({ request, target, proxy });
    } catch {
      return error(502);
    }
  },
};

async function publicProxy(request, target, allows) {
  const allowed = url => url.protocol === 'https:'
    && url.hostname === target.hostname
    && !url.port && !url.username && !url.password && !url.hash
    && allows(url, request.method);
  if (!PUBLIC_HOSTS.has(target.hostname) || !allowed(target)) return error(403);

  // Construct headers from scratch so credentials, cookies and client identity
  // headers cannot reach any of these anonymous upstreams.
  const headers = new Headers();
  for (const header of PUBLIC_HEADERS) {
    if (request.headers.has(header)) headers.set(header, request.headers.get(header));
  }
  headers.set('host', target.hostname);
  const git = target.hostname === 'github.com';
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'POST' ? request.body : null,
    redirect: 'manual',
    ...(git ? { cache: 'no-store' } : {}),
  });

  // A private repository must fail without asking Git to collect credentials.
  if (upstream.status === 401 || upstream.status === 407) {
    await upstream.body?.cancel();
    return error(403);
  }
  const response = new Response(upstream.body, upstream);
  for (const header of ['set-cookie', 'set-cookie2', 'www-authenticate',
    'proxy-authenticate', 'authentication-info', 'proxy-authentication-info']) {
    response.headers.delete(header);
  }
  if (git) response.headers.set('cache-control', 'no-store');

  if (REDIRECTS.has(response.status)) {
    const location = response.headers.get('location');
    const next = location ? URL.parse(location, target.href) : null;
    // Only method-preserving redirects can carry an upload-pack POST. Return
    // redirects to the client so streamed request bodies never need replaying here.
    if (!next || !allowed(next)
      || (request.method === 'POST' && response.status !== 307 && response.status !== 308)) {
      await response.body?.cancel();
      return error(502);
    }
    response.headers.set('location', proxyURL(new URL(request.url).origin, next));
  }
  return response;
}

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
