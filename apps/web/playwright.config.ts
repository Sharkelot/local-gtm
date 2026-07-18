import { defineConfig, devices } from '@playwright/test';

const inheritedEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) inheritedEnv[key] = value;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...inheritedEnv,
      DEMO_AUTH_BYPASS: 'true',
      INFERENCE_WORKER_TOKEN: 'e2e-worker-token',
      DEV_ENVELOPE_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  },
});
