import { test, expect } from '@playwright/test';
import { observedIP, origin, saveIP } from './helpers.js';

test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.80' } });

test('local D1 gates access; home negotiation and HEAD preserve the shell entry point', async ({ request }) => {
  const ip = await observedIP(request);
  await saveIP(request, { ip, enabled: false });
  const denied = await request.get('/?format=html');
  expect(denied.status()).toBe(403);
  expect(await denied.text()).toBe('');
  await saveIP(request, { ip, enabled: true });

  for (const [path, accept, type] of [
    ['/', '*/*', 'text/plain'],
    ['/', 'text/html', 'text/html'],
    ['/', 'text/html;q=0.3,text/plain;q=0.9', 'text/plain'],
    ['/', 'text/html;q=0,*/*;q=1', 'text/plain'],
    ['/?format=html', '*/*', 'text/html'],
    ['/?format=script', 'text/html', 'text/plain'],
  ]) {
    const response = await request.get(path, { headers: { Accept: accept } });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain(type);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers().vary).toBe('Accept');
    const body = await response.text();
    if (type === 'text/html') {
      expect(body).toContain('<h1 id="fast">fast</h1>');
      expect(body).not.toMatch(/\{\{(?:CONTENT|TOC)\}\}/);
      expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
    } else {
      expect(body).toMatch(/^#Setup\n/);
      // Wrangler dev forwards the local request using the configured route host.
      expect(body).toContain("fast_registry='http://fast.thanejoss.com/registry.npmjs.org/'");
      expect(body).not.toMatch(/__FAST_(VERSION|NPM_REGISTRY)__/);
    }
    const head = await request.head(path, { headers: { Accept: accept } });
    expect(head.status()).toBe(200);
    expect(head.headers()['content-type']).toBe(response.headers()['content-type']);
    expect(await head.body()).toHaveLength(0);
  }
  expect((await request.get('/unlisted.example/file')).status()).toBe(403);
});

test('local admin rejects cross-origin mutations and invalid input; group deletion preserves permissions', async ({ request }) => {
  const ip = await observedIP(request);
  expect((await request.post('/admin/api/groups', { data: { name: 'blocked' } })).status()).toBe(403);
  expect((await request.put('/admin/api/ips', {
    headers: { Origin: origin }, data: { ip, enabled: 'true' },
  })).status()).toBe(400);
  expect((await request.get('/admin/api/ips?page=0')).status()).toBe(400);
  expect((await request.get('/admin/missing')).status()).toBe(404);

  const group = await request.post('/admin/api/groups', {
    headers: { Origin: origin }, data: { name: `test-${Date.now()}` },
  });
  expect(group.status()).toBe(201);
  const { id } = await group.json();
  await saveIP(request, { ip, enabled: true, group_id: id, note: 'local integration' });
  const deleted = await request.delete(`/admin/api/groups/${id}`, { headers: { Origin: origin } });
  expect(deleted.ok()).toBeTruthy();
  const result = await request.get(`/admin/api/ips?q=${encodeURIComponent(ip)}`);
  const row = (await result.json()).ips.find(row => row.ip === ip);
  expect(row).toMatchObject({ enabled: 1, group_id: null, note: 'local integration' });
});
