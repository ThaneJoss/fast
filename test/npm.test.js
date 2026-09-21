import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

// Load Wrangler's text and extensionless modules without adding runtime dependencies.
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const entryURL = new URL('../index.js', import.meta.url);
let source = await readFile(entryURL, 'utf8');
for (const match of source.matchAll(/from '(\.\/[^']+)'/g)) {
  const contents = await readFile(new URL(match[1], entryURL), 'utf8');
  const module = match[1].endsWith('.sh') ? `export default ${JSON.stringify(contents)}` : contents;
  source = source.replace(match[0], `from '${moduleURL(module)}'`);
}
const { default: worker } = await import(moduleURL(source));
const origin = 'https://fast.example';
const request = (path, init) => new Request(`${origin}/registry.npmjs.org${path}`, init);
const metadata = {
  name: '@scope/example',
  description: '中文 📦',
  versions: {
    '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/@scope/example/-/example-1.0.0.tgz' } },
    '0.9.0': { dist: { tarball: 'http://registry.npmjs.org/@scope/example/-/example-0.9.0.tgz' } },
  },
  homepage: 'https://registry.npmjs.org.example.com/unchanged',
  repository: 'https://github.com/example/project',
};
const expectedMetadata = structuredClone(metadata);
for (const version of Object.values(expectedMetadata.versions)) {
  version.dist.tarball = `${origin}/registry.npmjs.org${new URL(version.dist.tarball).pathname}`;
}

test('routes normal and scoped packages, preserving queries and request headers', async t => {
  for (const path of ['/is-number', '/@scope%2fexample', '/@scope/example/1.0.0']) {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.href, `https://registry.npmjs.org${path}?write=true`);
      assert.equal(init.headers.get('host'), 'registry.npmjs.org');
      assert.equal(init.headers.get('accept'), 'application/vnd.npm.install-v1+json');
      return Response.json(metadata);
    });
    const response = await worker.fetch(request(`${path}?write=true`, {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expectedMetadata);
  }
});

test('rewrites full and abbreviated metadata across every byte boundary', async t => {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  for (const contentType of ['application/json; charset=utf-8', 'application/vnd.npm.install-v1+json']) {
    for (let boundary = 1; boundary < bytes.length; boundary++) {
      t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, boundary));
          controller.enqueue(bytes.slice(boundary));
          controller.close();
        },
      }), {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(bytes.length),
          'Content-Encoding': 'gzip',
          ETag: '"upstream"',
          'Cache-Control': 'public, max-age=300',
        },
      }));
      const response = await worker.fetch(request('/@scope%2fexample'));
      assert.deepEqual(await response.json(), expectedMetadata);
      for (const header of ['content-length', 'content-encoding', 'etag']) {
        assert.equal(response.headers.has(header), false);
      }
      assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
      t.mock.restoreAll();
    }
  }
});

test('streams metadata before the upstream response finishes', { timeout: 2000 }, async t => {
  let upstream;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      upstream = controller;
      controller.enqueue(new TextEncoder().encode('{"name":"example",'));
    },
  }), { headers: { 'Content-Type': 'application/json' } }));
  const response = await worker.fetch(request('/example'));
  const reader = response.body.getReader();
  try {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    assert.equal(new TextDecoder().decode(value), '{"name":"example",');
  } finally {
    upstream.close();
    await reader.cancel();
  }
});

test('preserves tarball bytes, Range requests, and cache validators', async t => {
  const bytes = new Uint8Array([0, 255, 31, 139, 1, 128]);
  for (const status of [200, 206]) {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.pathname, '/@scope/example/-/example-1.0.0.tgz');
      assert.equal(init.headers.get('range'), 'bytes=0-5');
      assert.equal(init.headers.get('if-none-match'), '"tarball"');
      return new Response(bytes, {
        status,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '6', ETag: '"tarball"' },
      });
    });
    const response = await worker.fetch(request('/@scope/example/-/example-1.0.0.tgz', {
      headers: { Range: 'bytes=0-5', 'If-None-Match': '"tarball"' },
    }));
    assert.equal(response.status, status);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('etag'), '"tarball"');
    assert.equal(response.headers.get('content-length'), '6');
  }
});

test('handles HEAD and passes through 304 and upstream errors', async t => {
  for (const status of [200, 304, 404]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(status === 404 ? '{"error":"Not found"}' : null, {
      status,
      headers: { 'Content-Type': 'application/json', ETag: '"metadata"' },
    }));
    const response = await worker.fetch(request('/example', { method: status === 200 ? 'HEAD' : 'GET' }));
    assert.equal(response.status, status);
    assert.equal(response.headers.has('etag'), status !== 200);
    assert.equal(await response.text(), status === 404 ? '{"error":"Not found"}' : '');
  }
});

test('forwards both audit POST endpoints with the original compressed body', async t => {
  const body = gzipSync('{"is-number":["7.0.0"]}');
  for (const path of ['/-/npm/v1/security/advisories/bulk', '/-/npm/v1/security/audits/quick']) {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.pathname, path);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.get('content-encoding'), 'gzip');
      assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), new Uint8Array(body));
      return Response.json({});
    });
    const response = await worker.fetch(request(path, {
      method: 'POST', body, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
  }
});

test('forwards registry write methods, bodies, authentication, and upstream responses', async t => {
  const body = '{"name":"example","value":"test"}';
  const result = '{"url":"https://registry.npmjs.org/example"}';
  for (const [path, method] of [['/example', 'PUT'], ['/example', 'DELETE'], ['/-/v1/login', 'POST'],
    ['/-/npm/v1/user', 'PATCH'], ['/example', 'OPTIONS'], ['/-/npm/v1/security/audits/quick/extra', 'POST']]) {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.href, `https://registry.npmjs.org${path}`);
      assert.equal(init.method, method);
      assert.equal(await new Response(init.body).text(), body);
      assert.equal(init.headers.get('authorization'), 'Bearer test-token');
      assert.equal(init.headers.get('npm-otp'), 'test-otp');
      return new Response(result, { headers: { 'Content-Type': 'application/json', ETag: '"write-result"' } });
    });
    const response = await worker.fetch(request(path, {
      method, body, headers: { Authorization: 'Bearer test-token', 'npm-otp': 'test-otp', 'Content-Type': 'application/json' },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.has('etag'), false);
    assert.equal(await response.text(), `{"url":"${origin}/registry.npmjs.org/example"}`);
  }
  for (const status of [201, 401, 403, 405]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(result, { status }));
    const response = await worker.fetch(request('/example', { method: 'PUT', body }));
    assert.equal(response.status, status);
    assert.equal(await response.text(), result);
  }
});

test('forwards standard and custom methods and bodies for both Ubuntu hosts', async t => {
  for (const host of ['archive.ubuntu.com', 'security.ubuntu.com']) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'PROPFIND']) {
      const body = ['GET', 'HEAD'].includes(method) ? undefined : 'request payload';
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url.href, `https://${host}/ubuntu/?test=1`);
        assert.equal(init.method, method);
        assert.equal(await new Response(init.body).text(), body ?? '');
        return new Response(method === 'HEAD' ? null : 'upstream response');
      });
      const response = await worker.fetch(new Request(`${origin}/${host}/ubuntu/?test=1`, { method, body }));
      assert.equal(response.status, 200);
      assert.equal(await response.text(), method === 'HEAD' ? '' : 'upstream response');
    }
  }
});

test('serves the root script for all methods and returns an empty HEAD response', async () => {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'PROPFIND']) {
    const response = await worker.fetch(new Request(`${origin}/`, { method }), {
      CF_VERSION_METADATA: { id: 'fixture-version' },
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    if (method === 'HEAD') assert.equal(text, '');
    else assert.match(text, /Version fixture-version/);
  }
});

test('matches the host allowlist against the actual hostname', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected upstream request'));
  for (const authority of ['example.com', 'registry.npmjs.org@example.com:8443', 'registry.npmjs.org:invalid']) {
    assert.equal((await worker.fetch(new Request(`${origin}/${authority}/`))).status, 403);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('keeps registry redirects on the proxy and rejects redirects outside the allowlist', async t => {
  for (const host of ['registry.npmjs.org', 'example.com']) {
    t.mock.method(globalThis, 'fetch', async () => Response.redirect(`https://${host}/example/-/example-1.0.0.tgz`, 302));
    const response = await worker.fetch(request('/example/latest'));
    assert.equal(response.status, host === 'registry.npmjs.org' ? 302 : 502);
    assert.equal(response.headers.get('location'), host === 'registry.npmjs.org'
      ? `${origin}/registry.npmjs.org/example/-/example-1.0.0.tgz` : null);
  }
});

test('follows redirects with custom ports and URL credentials through the proxy', async t => {
  for (const destination of [
    'https://registry.npmjs.org:8443/package?download=1#file',
    'https://test-user:test-password@registry.npmjs.org/package',
    'https://test-user:p%40ss%3Aword@registry.npmjs.org:8443/package',
    'https://%E7%94%A8%E6%88%B7:test-password@registry.npmjs.org:8443/package',
    'https://test-user@registry.npmjs.org:8443/package',
    'http://test-user:test-password@registry.npmjs.org:8080/package',
  ]) {
    const target = new URL(destination);
    const location = `${origin}/${target.href.slice(target.protocol.length + 2)}`;
    t.mock.method(globalThis, 'fetch', async () => Response.redirect(destination, 307));
    const redirect = await worker.fetch(request('/start', { method: 'PUT', body: 'package payload' }));
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get('location'), location);
    const expected = new URL(target);
    expected.protocol = 'https:';
    expected.hash = '';
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.href, expected.href);
      assert.equal(init.headers.get('host'), target.host);
      assert.equal(init.method, 'PUT');
      assert.equal(await new Response(init.body).text(), 'package payload');
      assert.equal(init.headers.get('authorization'), 'Bearer test-token');
      return new Response('uploaded', { status: 201 });
    });
    const response = await worker.fetch(new Request(location, {
      method: 'PUT', body: 'package payload', headers: { Authorization: 'Bearer test-token' },
    }));
    assert.equal(response.status, 201);
    assert.equal(await response.text(), 'uploaded');
  }
});

test('does not generate an Authorization header from URL credentials', async t => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url.href, 'https://test-user:test-password@registry.npmjs.org:8443/package');
    assert.equal(init.headers.has('authorization'), false);
    return new Response('ok');
  });
  const response = await worker.fetch(new Request(`${origin}/test-user:test-password@registry.npmjs.org:8443/package`));
  assert.equal(response.status, 200);
});

test('relative redirects retain the current port and URL credentials', async t => {
  const authority = 'test-user:test-password@archive.ubuntu.com:8443';
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { Location: '../next?test=1' } }));
  const response = await worker.fetch(new Request(`${origin}/${authority}/ubuntu/start`));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), `${origin}/${authority}/next?test=1`);
});

test('a double-slash upstream path does not change the destination host', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.href, 'https://registry.npmjs.org:8443//example.com/package');
    return new Response('ok');
  });
  const response = await worker.fetch(new Request(`${origin}/registry.npmjs.org:8443//example.com/package`));
  assert.equal(response.status, 200);
});
