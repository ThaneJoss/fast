import assert from 'node:assert/strict';
import test from 'node:test';
import proxy from '../proxy.js';

const origin = 'https://fast.example:8443';
const registry = `${origin}/registry.npmjs.org/`;

test('routes encoded scoped metadata paths and queries and rewrites tarballs through the npm handler', async t => {
  const path = '@scope%2fexample?write=true&tag=next%2Btest&tag=latest';
  const metadata = {
    name: '@scope/example',
    versions: {
      '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/@scope/example/-/example-1.0.0.tgz', integrity: 'sha512-example' } },
    },
  };
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(metadata), {
    headers: { 'content-type': 'application/vnd.npm.install-v1+json', etag: '"upstream"' },
  }));

  const response = await proxy.fetch(new Request(`${registry}${path}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  }), {});

  assert.equal(response.status, 200);
  assert.equal(fetch.mock.callCount(), 1);
  const [target, options] = fetch.mock.calls[0].arguments;
  assert.equal(target.href, `https://registry.npmjs.org/${path}`);
  assert.equal(options.headers.get('host'), 'registry.npmjs.org');
  assert.equal(options.headers.get('accept'), 'application/vnd.npm.install-v1+json');
  assert.equal(options.redirect, 'manual');
  metadata.versions['1.0.0'].dist.tarball = `${registry}@scope/example/-/example-1.0.0.tgz`;
  assert.deepEqual(await response.json(), metadata);
  assert.equal(response.headers.get('etag'), null);
});

test('forwards npm POST bodies, authorization and cookies and preserves upstream response cookies', async t => {
  const body = '{"example":["1.0.0"]}';
  const request = new Request(`${registry}-/npm/v1/security/advisories/bulk?format=json`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      cookie: 'session=test-session',
      'content-type': 'application/json',
      'npm-command': 'audit',
      host: 'fast.example:8443',
    },
    body,
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{"ok":true}', {
    status: 201,
    headers: { 'content-type': 'application/json', 'set-cookie': 'session=updated; Secure; HttpOnly' },
  }));

  const response = await proxy.fetch(request, {});

  assert.equal(response.status, 201);
  assert.equal(fetch.mock.callCount(), 1);
  const [target, options] = fetch.mock.calls[0].arguments;
  assert.equal(target.href, 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk?format=json');
  assert.equal(options.method, 'POST');
  assert.equal(options.body, request.body);
  assert.equal(await new Response(options.body).text(), body);
  assert.equal(options.headers.get('authorization'), 'Bearer test-token');
  assert.equal(options.headers.get('cookie'), 'session=test-session');
  assert.equal(options.headers.get('content-type'), 'application/json');
  assert.equal(options.headers.get('npm-command'), 'audit');
  assert.equal(options.headers.get('host'), 'registry.npmjs.org');
  assert.equal(request.headers.get('host'), 'fast.example:8443');
  assert.equal(response.headers.get('set-cookie'), 'session=updated; Secure; HttpOnly');
  assert.equal(await response.text(), '{"ok":true}');
});

test('preserves tarball partial bytes and forwards range and conditional headers', async t => {
  const bytes = new Uint8Array([0, 255, 31, 139, 8, 0, 10, 13]);
  const requestHeaders = {
    range: 'bytes=0-7',
    'if-range': '"tarball-v1"',
    'if-none-match': '"previous"',
    'if-modified-since': 'Tue, 01 Sep 2026 00:00:00 GMT',
  };
  const responseHeaders = {
    'content-type': 'application/octet-stream',
    'content-range': 'bytes 0-7/1024',
    'content-length': String(bytes.length),
    'accept-ranges': 'bytes',
    etag: '"tarball-v1"',
    'last-modified': 'Wed, 02 Sep 2026 00:00:00 GMT',
    'cache-control': 'public, max-age=31536000, immutable',
  };
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(bytes, {
    status: 206, headers: responseHeaders,
  }));

  const response = await proxy.fetch(new Request(`${registry}@scope/example/-/example-1.0.0.tgz`, {
    headers: requestHeaders,
  }), {});

  assert.equal(response.status, 206);
  const [target, options] = fetch.mock.calls[0].arguments;
  assert.equal(target.href, 'https://registry.npmjs.org/@scope/example/-/example-1.0.0.tgz');
  assert.equal(options.method, 'GET');
  for (const [name, value] of Object.entries(requestHeaders)) assert.equal(options.headers.get(name), value, name);
  for (const [name, value] of Object.entries(responseHeaders)) assert.equal(response.headers.get(name), value, name);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('forwards HEAD and preserves bodyless conditional responses', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 304,
    headers: { 'content-type': 'application/json', etag: '"metadata-v1"', 'cache-control': 'public, max-age=300' },
  }));

  const response = await proxy.fetch(new Request(`${registry}example`, {
    method: 'HEAD', headers: { 'if-none-match': '"metadata-v1"' },
  }), {});

  assert.equal(response.status, 304);
  const [, options] = fetch.mock.calls[0].arguments;
  assert.equal(options.method, 'HEAD');
  assert.equal(options.body, null);
  assert.equal(options.headers.get('if-none-match'), '"metadata-v1"');
  assert.equal(response.headers.get('etag'), '"metadata-v1"');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(response.body, null);
});

test('rewrites allowed relative and absolute upstream redirects without following them', async t => {
  let upstream;
  const fetch = t.mock.method(globalThis, 'fetch', async () => upstream);
  for (const [status, location, expected] of [
    [301, './-/example-1.0.0.tgz?download=1', `${registry}-/example-1.0.0.tgz?download=1`],
    [302, 'https://registry.npmjs.org/@scope/example/-/example.tgz', `${registry}@scope/example/-/example.tgz`],
    [303, 'http://registry.npmjs.org/example?tag=latest', `${registry}example?tag=latest`],
    [307, '//registry.npmjs.org/example', `${registry}example`],
    [308, 'https://archive.ubuntu.com/ubuntu/', `${origin}/archive.ubuntu.com/ubuntu/`],
  ]) {
    upstream = new Response(null, { status, headers: { location } });
    const response = await proxy.fetch(new Request(`${registry}example`), {});
    assert.equal(response.status, status, location);
    assert.equal(response.headers.get('location'), expected, location);
  }
  assert.equal(fetch.mock.callCount(), 5);
  for (const call of fetch.mock.calls) assert.equal(call.arguments[1].redirect, 'manual');
});

test('rejects upstream redirects outside the host and protocol allowlist and cancels their bodies', async t => {
  let upstream;
  const fetch = t.mock.method(globalThis, 'fetch', async () => upstream);
  const locations = [
    'https://example.net/package.tgz',
    '//registry.npmjs.org.evil.example/package.tgz',
    'https://registry.npmjs.org@evil.example/package.tgz',
    'ftp://registry.npmjs.org/package.tgz',
    'javascript:alert(1)',
  ];
  for (const location of locations) {
    let cancelled = false;
    upstream = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: 302, headers: { location },
    });
    const response = await proxy.fetch(new Request(`${registry}example`), {});
    assert.equal(response.status, 502, location);
    assert.equal(response.headers.get('location'), null, location);
    assert.equal(await response.text(), '', location);
    assert.equal(cancelled, true, location);
  }
  assert.equal(fetch.mock.callCount(), locations.length);
});

test('maps upstream connection failures to 502 and rejects unknown upstream hosts before fetching', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Connection failed'); });
  const response = await proxy.fetch(new Request(`${registry}example`), {});
  assert.equal(response.status, 502);
  assert.equal(await response.text(), '');

  const denied = await proxy.fetch(new Request(`${origin}/registry.npmjs.org.evil.example/example`), {});
  assert.equal(denied.status, 403);
  assert.equal(fetch.mock.callCount(), 1);
});

test('keeps a double-slash npm path on the allowed registry host', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('not found', { status: 404 }));
  const response = await proxy.fetch(new Request(`${registry}/evil.example/package`), {});
  assert.equal(response.status, 404);
  assert.equal(fetch.mock.calls[0].arguments[0].href, 'https://registry.npmjs.org//evil.example/package');
});
