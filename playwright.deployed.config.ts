import { defineConfig, devices } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const expectedSourceSha = process.env.EXPECTED_SOURCE_SHA;
const deploymentStage = process.env.DEPLOYMENT_STAGE;

if (!baseUrl) throw new Error("PLAYWRIGHT_BASE_URL is required for deployed tests");
if (!expectedSourceSha || !/^[0-9a-f]{40}$/i.test(expectedSourceSha)) {
  throw new Error("EXPECTED_SOURCE_SHA must be a full 40-character commit SHA");
}
if (deploymentStage !== "preview" && deploymentStage !== "production") {
  throw new Error("DEPLOYMENT_STAGE must be preview or production");
}

const parsedBaseUrl = new URL(baseUrl);
const expectedPath = deploymentStage === "preview"
  ? "/ruby-playground/staging/"
  : "/ruby-playground/";
if (parsedBaseUrl.protocol !== "https:") {
  throw new Error("PLAYWRIGHT_BASE_URL must use HTTPS");
}
if (parsedBaseUrl.origin !== "https://glassmonkey.github.io") {
  throw new Error("PLAYWRIGHT_BASE_URL must use the standard GitHub Pages host");
}
if (parsedBaseUrl.pathname !== expectedPath || parsedBaseUrl.search || parsedBaseUrl.hash) {
  throw new Error(`PLAYWRIGHT_BASE_URL must use the ${deploymentStage} path ${expectedPath}`);
}

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: true,
  retries: 0,
  use: {
    baseURL: parsedBaseUrl.toString(),
    trace: "retain-on-failure",
  },
  projects: [{ name: "deployed-chromium", use: { ...devices["Desktop Chrome"] } }],
});
