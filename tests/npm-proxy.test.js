import assert from 'node:assert/strict';
import test from 'node:test';
import npm from '../hosts/registry.npmjs.org';

const origin = 'https://fast.example';
const registry = `${origin}/registry.npmjs.org/`;
const encoder = new TextEncoder();

function chunked(text, size = 64) {
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += size) {
        controller.enqueue(bytes.slice(offset, offset + size));
      }
      controller.close();
    },
  });
}

function rewrite(response, request = new Request(`${registry}@scope%2fexample`)) {
  const target = new URL('https://registry.npmjs.org/@scope%2fexample');
  return npm({
    request, target,
    proxy: async (forwardedRequest, forwardedTarget) => {
      assert.equal(forwardedRequest, request);
      assert.equal(forwardedTarget, target);
      return response;
    },
  });
}

test('rewrites npm tarball URLs across byte boundaries without changing other metadata', async () => {
  const metadata = {
    name: '@scope/example',
    description: '中文 📦 — see "https://registry.npmjs.org/example"',
    readme: 'An escaped slash \\ followed by a quote " and another URL https://registry.npmjs.org/example',
    empty: '',
    versions: {
      '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/@scope/example/-/example-1.0.0.tgz', integrity: 'sha512-unchanged', shasum: 'unchanged' } },
      '2.0.0': { dist: { tarball: 'http://registry.npmjs.org/example/-/example-2.0.0.tgz?download=1' } },
    },
    urls: ['https://registry.npmjs.org.evil.example/file', 'https://other.example/file', 'https://registry.npmjs.org', 'h', 'https:'],
  };
  const expected = structuredClone(metadata);
  expected.versions['1.0.0'].dist.tarball = `${registry}@scope/example/-/example-1.0.0.tgz`;
  expected.versions['2.0.0'].dist.tarball = `${registry}example/-/example-2.0.0.tgz?download=1`;

  for (const contentType of ['application/json; charset=utf-8', 'application/vnd.npm.install-v1+json']) {
    const response = await rewrite(new Response(chunked(JSON.stringify(metadata), 1), {
      headers: { 'content-type': contentType },
    }));
    assert.deepEqual(await response.json(), expected);
  }
});

test('recognizes JSON slash and Unicode escapes split between chunks', async () => {
  const unicodePrefix = [...'https://registry.npmjs.org/']
    .map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const source = String.raw`{"slash":"https:\/\/registry.npmjs.org\/example/-/example.tgz","mixed":"http:\/\/registry.npmjs.org/example.tgz","unicode":"${unicodePrefix}example.tgz","description":"\"https:\/\/registry.npmjs.org\/example\""}`;

  for (const size of [1, 2, 7, source.length]) {
    const response = await rewrite(new Response(chunked(source, size), {
      headers: { 'content-type': 'application/json' },
    }));
    assert.deepEqual(await response.json(), {
      slash: `${registry}example/-/example.tgz`,
      mixed: `${registry}example.tgz`,
      unicode: `${registry}example.tgz`,
      description: '"https://registry.npmjs.org/example"',
    });
  }
});

test('removes upstream byte counts and validators only for transformed metadata', async () => {
  const headers = {
    'content-type': 'application/json',
    'content-length': '500',
    'content-encoding': 'gzip',
    etag: '"upstream"',
    'last-modified': 'Tue, 01 Sep 2026 00:00:00 GMT',
    'content-md5': 'upstream-md5',
    digest: 'sha-256=upstream',
    'content-digest': 'sha-256=:upstream:',
    'repr-digest': 'sha-256=:upstream:',
    'cache-control': 'public, max-age=300',
    vary: 'Accept',
  };
  for (const method of ['GET', 'HEAD']) {
    const response = await rewrite(new Response(method === 'HEAD' ? null : '{}', { headers }),
      new Request(registry, { method }));
    for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified', 'content-md5', 'digest', 'content-digest', 'repr-digest']) {
      assert.equal(response.headers.get(name), null, `${method}: ${name}`);
    }
    assert.equal(response.headers.get('cache-control'), headers['cache-control']);
    assert.equal(response.headers.get('vary'), 'Accept');
    assert.equal(await response.text(), method === 'HEAD' ? '' : '{}');
  }
});

test('preserves tarball bytes, ranges, conditional responses and upstream errors', async () => {
  for (const [status, contentType] of [
    [200, 'application/octet-stream'], [200, 'application/json-seq'],
    [206, 'application/json'], [304, 'application/json'],
    [401, 'application/json'], [404, 'application/json'],
  ]) {
    const bytes = new Uint8Array([0, 255, 10, ...encoder.encode('"https://registry.npmjs.org/file"')]);
    const upstream = new Response(status === 304 ? null : bytes, {
      status,
      headers: { 'content-type': contentType, etag: '"keep"', 'content-range': 'bytes 0-33/100' },
    });
    const response = await rewrite(upstream);
    assert.equal(response, upstream);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('etag'), '"keep"');
    assert.equal(response.headers.get('content-range'), 'bytes 0-33/100');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), status === 304 ? new Uint8Array() : bytes);
  }
});

test('forwards methods, authorization, range headers and request bodies unchanged', async () => {
  const request = new Request(`${registry}-/npm/v1/security/advisories/bulk`, {
    method: 'POST',
    headers: { authorization: 'Bearer example-token', range: 'bytes=0-99', 'content-type': 'application/json' },
    body: '{"example":["1.0.0"]}',
  });
  await rewrite(new Response('{}', { headers: { 'content-type': 'application/json' } }), request);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('authorization'), 'Bearer example-token');
  assert.equal(request.headers.get('range'), 'bytes=0-99');
  assert.equal(await request.text(), '{"example":["1.0.0"]}');
});

test('emits a large unfinished metadata string before upstream closes', async () => {
  let upstream;
  const source = new ReadableStream({ start(controller) { upstream = controller; } });
  const response = await rewrite(new Response(source, { headers: { 'content-type': 'application/json' } }));
  const reader = response.body.getReader();
  const firstChunk = `{"description":"${'x'.repeat(32 * 1024)}`;
  upstream.enqueue(encoder.encode(firstChunk));
  let timeout;
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('metadata was buffered')), 1000); }),
    ]);
    assert.equal(first.done, false);
    assert.equal(new TextDecoder().decode(first.value), firstChunk);
  } finally {
    clearTimeout(timeout);
    upstream.close();
    await reader.cancel();
  }
});
