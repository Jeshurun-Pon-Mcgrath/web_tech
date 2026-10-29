import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
process.env.EXAMLEDGER_BROWSER_ADMIN_PASSWORD ||= randomBytes(24).toString('hex');
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/test/browser-server.js',
      url: 'http://127.0.0.1:4100/api/v1/health',
      timeout: 180000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -w @examledger/web -- --port 4173',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:4100', VITE_API_BASE: '/api/v1' },
      url: 'http://127.0.0.1:4173',
      timeout: 60000,
      reuseExistingServer: false,
    },
  ],
});
