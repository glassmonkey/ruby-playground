import { defineConfig } from "@playwright/test";

// Backend end-to-end checks replay recorded RubyGems responses through a local
// cassette server and Wrangler Worker. GEM_PROXY_URL is reserved for an
// explicitly selected external proxy target.
const target = process.env.GEM_PROXY_URL ?? "http://127.0.0.1:8787";
const local = !process.env.GEM_PROXY_URL;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL: target },
  webServer: local
    ? [
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
      ]
    : undefined,
});
