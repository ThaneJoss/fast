import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
const req = (path, init) => new Request(`https://fast.thanejoss.com${path}`, init);

test('rejects allowlist bypasses without fetching', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected'); });
  for (const host of ['evil.com', 'archive.ubuntu.com.evil.com', 'archive.ubuntu.com@evil.com', 'archive.ubuntu.com:443', '%61rchive.ubuntu.com', 'archive.ubuntu.com.', '']) {
    assert.equal((await worker.fetch(req(`/${host}/ubuntu`))).status, 403);
  }
  assert.equal(mock.mock.callCount(), 0);
});

test('both hosts preserve bytes, query, range, validators and status', async (t) => {
  for (const host of ['archive.ubuntu.com', 'security.ubuntu.com']) {
    const bytes = new Uint8Array([0, 255, 128]);
    const mock = t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.href, `https://${host}/ubuntu/a%20b?x=1&x=2`);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.get('range'), 'bytes=0-2');
      assert.equal(init.headers.get('if-none-match'), '"v1"');
      assert.equal(init.headers.get('authorization'), null);
      assert.equal(init.headers.get('cookie'), null);
      return new Response(bytes, { status: 206, headers: { 'content-range': 'bytes 0-2/10', etag: '"v1"', 'set-cookie': 'secret=1' } });
    });
    const res = await worker.fetch(req(`/${host}/ubuntu/a%20b?x=1&x=2`, { headers: { range: 'bytes=0-2', 'if-none-match': '"v1"', authorization: 'secret', cookie: 'secret' } }));
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 0-2/10');
    assert.equal(res.headers.get('etag'), '"v1"');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
    mock.mock.restore();
  }
});

test('double-slash paths never change host; host-only uses root', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url.href); return new Response('ok'); });
  await worker.fetch(req('/archive.ubuntu.com//evil.com/file'));
  await worker.fetch(req('/archive.ubuntu.com'));
  assert.deepEqual(urls, ['https://archive.ubuntu.com//evil.com/file', 'https://archive.ubuntu.com/']);
});

test('HEAD preserves upstream status and empty body', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_, init) => { assert.equal(init.method, 'HEAD'); return new Response(null, { status: 404 }); });
  const res = await worker.fetch(req('/security.ubuntu.com/missing', { method: 'HEAD' }));
  assert.equal(res.status, 404);
  assert.equal(await res.text(), '');
});

test('POST is rejected without upstream access', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected'); });
  const res = await worker.fetch(req('/archive.ubuntu.com/', { method: 'POST', body: 'data' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
  assert.equal(mock.mock.callCount(), 0);
});

test('rewrites allowed redirects and blocks untrusted destinations', async (t) => {
  for (const [location, expected] of [
    ['next?x=1', 'https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/next?x=1'],
    ['http://security.ubuntu.com/ubuntu/', 'https://fast.thanejoss.com/security.ubuntu.com/ubuntu/'],
    ['//evil.com/file', null], ['https://archive.ubuntu.com.evil.com/', null],
    ['https://user:pass@archive.ubuntu.com/', null], ['https://archive.ubuntu.com:8443/', null],
    ['ftp://archive.ubuntu.com/', null], ['http://[', null],
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location } }));
    const res = await worker.fetch(req('/archive.ubuntu.com/ubuntu/file'));
    assert.equal(res.status, expected ? 302 : 502);
    assert.equal(res.headers.get('location'), expected);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test('upstream network failures return 502', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw Error('TLS failure'); });
  assert.equal((await worker.fetch(req('/archive.ubuntu.com/'))).status, 502);
});
