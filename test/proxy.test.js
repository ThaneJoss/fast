import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, afterEach } from 'node:test';

// Worker text modules and extensionless host modules are loaded by Wrangler in
// production. Match those module types without a build or network dependency.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './home/index.html' && context.parentURL === pathToFileURL(`${root}/home.js`).href) {
      return { url: pathToFileURL(`${root}/home/index.html`).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(pathToFileURL(`${root}/hosts/`).href)) {
      return { format: 'module', source: readFileSync(new URL(url), 'utf8'), shortCircuit: true };
    }
    if (url === pathToFileURL(`${root}/home/index.html`).href) {
      return { format: 'module', source: 'export default "unused home fixture";', shortCircuit: true };
    }
    if (url === pathToFileURL(`${root}/setup.sh`).href) {
      return { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { default: proxy } = await import(pathToFileURL(`${root}/proxy.js`).href);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const origin = 'https://proxy.test';
const githubDiscovery = '/github.com/nvm-sh/nvm.git/info/refs?service=git-upload-pack';
const githubUpload = '/github.com/nvm-sh/nvm.git/git-upload-pack';
const nodeIndex = '/nodejs.org/dist/index.tab';
const nvmInstaller = '/raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh';
const request = (path, init) => new Request(origin + path, init);
function mockUpstream(reply) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return typeof reply === 'function' ? reply(url, init) : reply;
  };
  return calls;
}

test('Git discovery forwards protocol negotiation anonymously and disables caching', async () => {
  const calls = mockUpstream(new Response('0000', {
    headers: { 'content-type': 'application/x-git-upload-pack-advertisement', 'cache-control': 'public, max-age=600', 'set-cookie': 'upstream=secret', 'www-authenticate': 'Basic realm="upstream"', 'authentication-info': 'secret' },
  }));
  const response = await proxy.fetch(request(githubDiscovery, {
    headers: { authorization: 'Basic secret', cookie: 'client=secret', 'proxy-authorization': 'Basic secret', 'cf-connecting-ip': '192.0.2.10', 'x-forwarded-for': '192.0.2.11', 'git-protocol': 'version=2', accept: '*/*' },
  }), {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '0000');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://github.com/nvm-sh/nvm.git/info/refs?service=git-upload-pack');
  assert.equal(calls[0].init.headers.get('git-protocol'), 'version=2');
  assert.equal(calls[0].init.headers.get('host'), 'github.com');
  for (const name of ['authorization', 'cookie', 'proxy-authorization', 'cf-connecting-ip', 'x-forwarded-for']) assert.equal(calls[0].init.headers.get(name), null, name);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const name of ['set-cookie', 'www-authenticate', 'authentication-info']) assert.equal(response.headers.get(name), null, name);
});

test('Git upload-pack forwards the original request stream without buffering', async () => {
  const req = request(githubUpload, { method: 'POST', body: '0012command=fetch\n', duplex: 'half', headers: { 'content-type': 'application/x-git-upload-pack-request', 'git-protocol': 'version=2' } });
  const requestStream = req.body;
  const responseStream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('PACK')); controller.close(); } });
  const upstream = new Response(responseStream, { headers: { 'content-type': 'application/x-git-upload-pack-result' } });
  const calls = mockUpstream(upstream);
  const response = await proxy.fetch(req, {});
  assert.equal(response.status, 200);
  assert.equal(calls[0].init.body, requestStream);
  assert.equal(req.bodyUsed, false);
  assert.equal(response.body, upstream.body);
  assert.equal(await response.text(), 'PACK');
});

test('disallowed Git routes, methods, content types and queries never reach upstream', async () => {
  const calls = mockUpstream(() => { throw new Error('Unexpected upstream call'); });
  const cases = [
    ['/github.com/nvm-sh/nvm', {}],
    ['/github.com/nvm-sh/nvm.git/info/refs', {}],
    ['/github.com/nvm-sh/nvm.git/info/refs?service=git-receive-pack', {}],
    [githubDiscovery + '&extra=1', {}],
    [githubDiscovery, { method: 'HEAD' }],
    [githubUpload, {}],
    [githubUpload, { method: 'POST', body: 'pack', headers: { 'content-type': 'text/plain' } }],
    ['/github.com/nvm-sh/nvm.git/git-receive-pack', { method: 'POST', body: 'pack', headers: { 'content-type': 'application/x-git-upload-pack-request' } }],
    [githubUpload + '?extra=1', { method: 'POST', body: 'pack', headers: { 'content-type': 'application/x-git-upload-pack-request' } }],
  ];
  for (const [path, init] of cases) assert.equal((await proxy.fetch(request(path, init), {})).status, 403, path);
  assert.equal(calls.length, 0);
});

test('public routes reject credentials, ports and nonliteral authority', async () => {
  const calls = mockUpstream(() => { throw new Error('Unexpected upstream call'); });
  for (const authority of ['user:pass@nodejs.org', 'nodejs.org:443', 'nodejs.org:8443', 'NODEJS.ORG', 'nodejs.org.', '%6eodejs.org']) {
    assert.equal((await proxy.fetch(request(`/${authority}/dist/index.tab`), {})).status, 403, authority);
  }
  assert.equal(calls.length, 0);
});

test('Node download preserves byte range and validators, strips identity and authentication', async () => {
  const calls = mockUpstream(new Response('bytes', { status: 206, headers: { 'content-type': 'application/octet-stream', 'content-range': 'bytes 0-4/100', etag: '"node-archive"', 'cache-control': 'public, max-age=3600', 'set-cookie': 'bad=1' } }));
  const response = await proxy.fetch(request('/nodejs.org/dist/v24.0.0/node-v24.0.0-linux-x64.tar.xz', { headers: { range: 'bytes=0-4', 'if-range': '"node-archive"', authorization: 'secret', cookie: 'secret' } }), {});
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'bytes');
  assert.equal(response.headers.get('content-range'), 'bytes 0-4/100');
  assert.equal(response.headers.get('etag'), '"node-archive"');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(calls[0].init.headers.get('range'), 'bytes=0-4');
  assert.equal(calls[0].init.headers.get('if-range'), '"node-archive"');
  assert.equal(calls[0].init.headers.get('authorization'), null);
  assert.equal(calls[0].init.headers.get('cookie'), null);
});

test('Node and nvm permit HEAD and fixed files, reject all other paths and queries', async () => {
  const calls = mockUpstream(() => new Response(null, { headers: { etag: '"version"' } }));
  for (const path of [nodeIndex, '/nodejs.org/dist', nvmInstaller, '/raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/nvm.sh', '/raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/nvm-exec', '/raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/bash_completion']) {
    assert.equal((await proxy.fetch(request(path, { method: 'HEAD' }), {})).status, 200, path);
  }
  assert.equal(calls.length, 6);
  for (const path of [nodeIndex + '?q=1', '/nodejs.org/other', '/nodejs.org/dist/../private', '/raw.githubusercontent.com/other/nvm/v0.40.8/nvm.sh', '/raw.githubusercontent.com/nvm-sh/nvm/master/nvm.sh', '/raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/README.md', nvmInstaller + '?q=1']) {
    assert.equal((await proxy.fetch(request(path), {})).status, 403, path);
  }
  assert.equal((await proxy.fetch(request(nodeIndex, { method: 'POST' }), {})).status, 403);
  assert.equal(calls.length, 6);
});

test('Git discovery rewrites safe renamed-repository redirects back through proxy', async () => {
  mockUpstream(new Response(null, { status: 301, headers: { location: 'https://github.com/new-owner/new-repo.git/info/refs?service=git-upload-pack' } }));
  const response = await proxy.fetch(request(githubDiscovery), {});
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), origin + '/github.com/new-owner/new-repo.git/info/refs?service=git-upload-pack');
});

test('redirects cannot escape the route host, protocol, method or path scope', async () => {
  for (const location of ['http://nodejs.org/dist/index.tab', 'https://evil.test/dist/index.tab', 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh', 'https://user:pass@nodejs.org/dist/index.tab', 'https://nodejs.org:8443/dist/index.tab', 'https://nodejs.org/outside', '/dist/index.tab?query=1', '/dist/index.tab#fragment', 'data:text/plain,hello']) {
    mockUpstream(new Response('redirect', { status: 302, headers: { location } }));
    const response = await proxy.fetch(request(nodeIndex), {});
    assert.equal(response.status, 502, location);
    assert.equal(await response.text(), '');
  }
});

test('download redirects preserve relative paths and HEAD', async () => {
  const calls = mockUpstream(new Response(null, { status: 308, headers: { location: './index.json' } }));
  const response = await proxy.fetch(request(nodeIndex, { method: 'HEAD' }), {});
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), origin + '/nodejs.org/dist/index.json');
  assert.equal(calls[0].init.method, 'HEAD');
  assert.equal(calls[0].init.body, null);
});

test('upload-pack permits 307/308 only and never replays the body in Worker', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const calls = mockUpstream(new Response(null, { status, headers: { location: 'https://github.com/new-owner/new-repo.git/git-upload-pack' } }));
    const response = await proxy.fetch(request(githubUpload, { method: 'POST', body: 'pack', headers: { 'content-type': 'application/x-git-upload-pack-request' } }), {});
    assert.equal(response.status, [307, 308].includes(status) ? status : 502);
    assert.equal(calls.length, 1);
    if ([307, 308].includes(status)) assert.equal(response.headers.get('location'), origin + '/github.com/new-owner/new-repo.git/git-upload-pack');
  }
});

test('authentication challenges become empty 403 and their response stream is cancelled', async () => {
  for (const status of [401, 407]) {
    let cancelled = false;
    mockUpstream(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers: { 'www-authenticate': 'Basic realm="private"' } }));
    const response = await proxy.fetch(request(githubDiscovery), {});
    assert.equal(response.status, 403);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.equal(cancelled, true);
  }
});

test('upstream connection failure returns empty 502', async () => {
  mockUpstream(() => { throw new TypeError('network failed'); });
  const response = await proxy.fetch(request(nvmInstaller), {});
  assert.equal(response.status, 502);
  assert.equal(await response.text(), '');
});

test('legacy Ubuntu and npm credentials and mutual redirects remain unchanged', async () => {
  const calls = mockUpstream(new Response(null, { status: 302, headers: { location: 'https://security.ubuntu.com/ubuntu/pool/package.deb', 'set-cookie': 'legacy=1' } }));
  const response = await proxy.fetch(request('/archive.ubuntu.com/ubuntu/pool/package.deb', { headers: { authorization: 'Basic legacy', cookie: 'legacy=1' } }), {});
  assert.equal(response.status, 302);
  assert.equal(calls[0].init.headers.get('authorization'), 'Basic legacy');
  assert.equal(calls[0].init.headers.get('cookie'), 'legacy=1');
  assert.equal(response.headers.get('set-cookie'), 'legacy=1');
  assert.equal(response.headers.get('location'), origin + '/security.ubuntu.com/ubuntu/pool/package.deb');
});

test('legacy redirect cannot switch into anonymous routes with its credentials', async () => {
  mockUpstream(new Response(null, { status: 302, headers: { location: 'https://nodejs.org/dist/index.tab' } }));
  assert.equal((await proxy.fetch(request('/registry.npmjs.org/package', { headers: { authorization: 'secret' } }), {})).status, 502);
});
