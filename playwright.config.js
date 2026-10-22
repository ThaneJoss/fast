import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8789',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'worker', testMatch: 'worker.spec.js' },
    { name: 'desktop', testMatch: 'ui.spec.js', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testMatch: 'ui.spec.js', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run test:serve',
    url: 'http://127.0.0.1:8789/admin',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
