import { defineConfig, devices } from "@playwright/test";
const port = process.env.PORT || "8888";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm --prefix proxy run fixtures:serve",
      url: "http://127.0.0.1:18787/health",
      timeout: 5 * 60 * 1000,
      reuseExistingServer: false,
    },
    {
      command: `WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/ruby-play-wrangler.log proxy/node_modules/.bin/wrangler dev --config proxy/wrangler.fixture.jsonc --ip 127.0.0.1 --port 8787 --inspector-port 0 --var ALLOWED_ORIGINS:http://127.0.0.1:${port}`,
      url: "http://127.0.0.1:8787/info/rainbow",
      timeout: 5 * 60 * 1000,
      reuseExistingServer: false,
    },
    {
      command:
        process.env.E2E_DEV_SERVER === "1"
          ? `VITE_GEM_PROXY_URL=http://127.0.0.1:8787 npx vite --host 127.0.0.1 --port ${port} --strictPort`
          : `VITE_GEM_PROXY_URL=http://127.0.0.1:8787 npm run build && npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
      url: `http://127.0.0.1:${port}/`,
      timeout: 5 * 60 * 1000,
      reuseExistingServer: false,
    },
  ],
});
