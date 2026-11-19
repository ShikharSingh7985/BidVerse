import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  timeout: 60_000,
  use: {
    channel: process.env.BIDVERSE_E2E_BROWSER_CHANNEL || undefined,
  },
});
