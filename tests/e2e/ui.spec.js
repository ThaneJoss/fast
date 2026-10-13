import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { noHorizontalOverflow, saveIP } from './helpers.js';

test.beforeEach(async ({ page, request }, testInfo) => {
  const ip = testInfo.project.name === 'mobile' ? '192.0.2.21' : '192.0.2.20';
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': ip });
  await request.get('/admin/api/state', { headers: { 'CF-Connecting-IP': ip } });
  await expect.poll(async () => {
    const result = await request.get(`/admin/api/ips?q=${ip}`);
    return (await result.json()).ips.some(row => row.ip === ip);
  }).toBe(true);
  await saveIP(request, { ip, enabled: true });
});

test('documentation supports keyboard navigation, narrow screens and accessible content', async ({ page }, testInfo) => {
  await page.goto('/?format=html');
  await expect(page.getByRole('heading', { name: 'fast', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到文档正文' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await noHorizontalOverflow(page);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('documentation.png'), fullPage: true });
});

test('admin keeps keyboard focus through permission changes and profile saves', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin');
  await expect(page.locator('#ip-list')).toHaveAttribute('aria-busy', 'false');
  const ip = await page.locator('#current-ip').textContent();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: ip, exact: true }) });
  const permission = card.locator('[data-focus-key^="permission:"]');
  await permission.focus();
  await page.keyboard.press('Enter');
  await expect(permission).toHaveText('放行 IP');
  await expect(permission).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(permission).toHaveText('取消放行');
  await expect(permission).toBeFocused();

  const profile = card.locator('[data-focus-key^="profile:"]');
  await expect(profile).toHaveAccessibleName(new RegExp(ip.replaceAll('.', '\\.')));
  await profile.focus();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: '分组与备注' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('备注', { exact: true }).fill(`浏览器验收 ${testInfo.project.name}`);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(card).toContainText(`浏览器验收 ${testInfo.project.name}`);
  await expect(profile).toBeFocused();
  await noHorizontalOverflow(page);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('admin.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('admin reports request failures and refresh recovers', async ({ page }) => {
  await page.route('**/admin/api/ips?**', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试数据库不可用' }),
  }));
  await page.goto('/admin');
  await expect(page.getByRole('status').filter({ hasText: '测试数据库不可用' })).toBeVisible();
  await expect(page.locator('#ip-list')).toHaveAttribute('aria-busy', 'false');
  await page.unroute('**/admin/api/ips?**');
  await page.getByRole('button', { name: '刷新数据' }).click();
  await expect(page.locator('#ip-list article').first()).toBeVisible();
});
