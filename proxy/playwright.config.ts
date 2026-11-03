import { defineConfig } from "@playwright/test";

// Backend E2E always replays recorded RubyGems responses through local HTTP
// fixtures and a local Wrangler Worker. Public proxy checks use the separate
// proxy/playwright.public.config.ts entry point.
const target = "http://127.0.0.1:8787";
const allowedOrigin = "http://127.0.0.1:18888";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  metadata: { allowedOrigin },
  use: { baseURL: target },
  webServer: [
    {
      command: "npm run fixtures:serve",
      cwd: import.meta.dirname,
      url: "http://127.0.0.1:18787/health",
      timeout: 2 * 60 * 1000,
      reuseExistingServer: false,
    },
    {
      command:
        "./node_modules/.bin/wrangler dev --config wrangler.fixture.jsonc --ip 127.0.0.1 --port 8787 --inspector-port 0 --var ALLOWED_ORIGINS:http://127.0.0.1:18888,http://127.0.0.1:8888",
      cwd: import.meta.dirname,
      url: `${target}/info/rainbow`,
      timeout: 2 * 60 * 1000,
      reuseExistingServer: false,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  ],
});
