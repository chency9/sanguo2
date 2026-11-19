import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:25369', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1440, height: 1000 } } }],
  webServer: { command: 'pnpm dev', url: 'http://127.0.0.1:25369', reuseExistingServer: !process.env.CI, timeout: 60000 },
});
