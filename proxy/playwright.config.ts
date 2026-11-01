import { defineConfig } from "@playwright/test";

// Backend end-to-end checks against a running gem proxy. By default they start
// `wrangler dev` here; GEM_PROXY_URL points them at a deployed proxy instead,
// with GEM_PROXY_ORIGIN set to an origin that proxy allows.
const target = process.env.GEM_PROXY_URL ?? "http://127.0.0.1:8787";
const local = !process.env.GEM_PROXY_URL;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL: target },
  webServer: local
    ? {
        command: "npm run dev",
        cwd: import.meta.dirname,
        url: `${target}/info/rake`,
        timeout: 2 * 60 * 1000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
