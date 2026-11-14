import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT || "6645";
const artifactKey = process.env.COMPLETION_ARTIFACT_KEY || "completion-local";

export default defineConfig({
  testDir: ".",
  testMatch: process.env.COMPLETION_TEST_MATCH || "completion.spec.ts",
  outputDir: `../test-results/${artifactKey}`,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    trace: "on",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/`,
    timeout: 5 * 60 * 1000,
    reuseExistingServer: false,
  },
});
