import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { noHorizontalOverflow, origin, saveIP } from './helpers.js';

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

test('rejected permission change keeps keyboard retry focus', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('#ip-list')).toHaveAttribute('aria-busy', 'false');
  const ip = await page.locator('#current-ip').textContent();
  const permission = page.locator(`[data-focus-key="permission:${ip}"]`);
  await page.route('**/admin/api/ips', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: '保存失败' }),
  }));
  await permission.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: '保存失败' })).toBeVisible();
  await expect(permission).toBeEnabled();
  await expect(permission).toBeFocused();
});

test('a completed permission change preserves focus moved during the request', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('#ip-list')).toHaveAttribute('aria-busy', 'false');
  const ip = await page.locator('#current-ip').textContent();
  const permission = page.locator(`[data-focus-key="permission:${ip}"]`);
  let releaseRequest;
  const pending = new Promise(resolve => { releaseRequest = resolve; });
  await page.route('**/admin/api/ips', async route => {
    await pending;
    await route.continue();
  });
  await permission.focus();
  await page.keyboard.press('Enter');
  await expect(permission).toBeDisabled();
  await page.getByRole('button', { name: '刷新数据' }).focus();
  releaseRequest();
  await expect(permission).toHaveText('放行 IP');
  await expect(page.getByRole('button', { name: '刷新数据' })).toBeFocused();
});

test('permission changes that remove the filtered card restore a stable focus target', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('#ip-list')).toHaveAttribute('aria-busy', 'false');
  const ip = await page.locator('#current-ip').textContent();
  await page.locator('#filter-enabled').getByRole('button', { name: '已放行', exact: true }).click();
  const permission = page.locator(`[data-focus-key="permission:${ip}"]`);
  await expect(permission).toBeVisible();
  await permission.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ip-list')).toHaveAttribute('aria-busy', 'false');
  await expect(permission).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新数据' })).toBeFocused();
});

test('profile saves that remove the filtered card restore a stable focus target', async ({ page, request }, testInfo) => {
  const ip = testInfo.project.name === 'mobile' ? '192.0.2.21' : '192.0.2.20';
  const name = `focus-${testInfo.project.name}-${Date.now()}`;
  const response = await request.post('/admin/api/groups', { headers: { Origin: origin }, data: { name } });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  try {
    await saveIP(request, { ip, group_id: id });
    await page.goto('/admin');
    await expect(page.locator('#ip-list')).toHaveAttribute('aria-busy', 'false');
    await page.locator('#filter-group').getByRole('button', { name, exact: true }).click();
    const profile = page.locator(`[data-focus-key="profile:${ip}"]`);
    await expect(profile).toBeVisible();
    await profile.focus();
    await page.keyboard.press('Enter');
    const editor = page.getByRole('dialog', { name: '分组与备注' });
    await editor.getByRole('button', { name: '未分组', exact: true }).click();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(page.locator('#ip-list')).toHaveAttribute('aria-busy', 'false');
    await expect(profile).toHaveCount(0);
    await expect(page.getByRole('button', { name: '刷新数据' })).toBeFocused();
  } finally {
    const deleted = await request.delete(`/admin/api/groups/${id}`, { headers: { Origin: origin } });
    expect(deleted.ok()).toBeTruthy();
  }
});
