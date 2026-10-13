import { expect } from '@playwright/test';

export const origin = 'http://127.0.0.1:8789';

export async function observedIP(request) {
  const response = await request.get('/admin/api/state');
  expect(response.ok()).toBeTruthy();
  const { ip } = await response.json();
  expect(ip).not.toBe('');
  // Access logging uses waitUntil; wait for the row before attempting to manage it.
  await expect.poll(async () => {
    const result = await request.get(`/admin/api/ips?q=${encodeURIComponent(ip)}`);
    return (await result.json()).ips.some(row => row.ip === ip);
  }).toBe(true);
  return ip;
}

export async function saveIP(request, data) {
  const response = await request.put('/admin/api/ips', { headers: { Origin: origin }, data });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
