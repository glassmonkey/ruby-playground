import { defineConfig } from "@playwright/test";

function requiredOrigin(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Public proxy E2E requires ${name}; set it to an explicit HTTP(S) origin.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an explicit HTTP(S) origin.`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be an explicit HTTP(S) origin.`);
  }
  return parsed.origin;
}

const target = requiredOrigin("GEM_PROXY_URL");
const allowedOrigin = requiredOrigin("GEM_PROXY_ORIGIN");

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../test-results/proxy-public",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  metadata: { allowedOrigin },
  use: { baseURL: target },
});
