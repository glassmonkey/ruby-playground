import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const expectedSourceSha = process.env.EXPECTED_SOURCE_SHA;
const deploymentStage = process.env.DEPLOYMENT_STAGE;
const standardUrl = "https://glassmonkey.github.io/ruby-playground/";

test.skip(!baseUrl, "Set PLAYWRIGHT_BASE_URL to run deployed-host checks");

type WasmRecord = { url: string; bytes: number; sha256: string };
type ReleaseInfo = {
  source_sha: string;
  base_path: string;
  stage: string;
  wasm: WasmRecord[];
};

type MeasuredResponse = {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
  request?: () => { sizes(): Promise<{ requestBodySize: number; responseBodySize: number }> };
};

async function responseEvidence(response: MeasuredResponse) {
  const headers = response.headers();
  const body = await response.body();
  const sizes = response.request
    ? await response.request().sizes()
    : { requestBodySize: 0, responseBodySize: body.byteLength };
  return {
    url: response.url(),
    status: response.status(),
    contentType: headers["content-type"] ?? "absent",
    contentEncoding: headers["content-encoding"] ?? "absent",
    cacheControl: headers["cache-control"] ?? "absent",
    contentLength: headers["content-length"] ?? "absent",
    bodyBytes: body.byteLength,
    requestBytes: sizes.requestBodySize,
    responseBytes: sizes.responseBodySize,
  };
}

test("published entry and WASM metadata match the requested release", async ({
  page,
  request,
}, testInfo) => {
  const appResponse = await request.get(baseUrl!);
  expect(appResponse.status()).toBe(200);
  expect(appResponse.headers()["content-type"]).toContain("text/html");
  const html = await appResponse.text();
  expect(html).toContain(`name="release-source" content="${expectedSourceSha}"`);
  expect(html).toContain(`name="release-stage" content="${deploymentStage}"`);
  const canonicalTag = html.match(/<link\b[^>]*>/gi)?.find((tag) =>
    /\brel=["']canonical["']/i.test(tag),
  );
  expect(canonicalTag).toContain(`href="${standardUrl}"`);

  const robotsTag = html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0];
  if (deploymentStage === "preview") {
    expect(robotsTag).toContain("noindex,nofollow");
    expect(robotsTag).toContain("data-pages-preview-noindex");
  } else {
    expect(robotsTag ?? "").not.toMatch(/noindex/i);
  }

  const releaseResponse = await request.get(new URL("release-info.json", baseUrl!).toString());
  expect(releaseResponse.status()).toBe(200);
  const release = await releaseResponse.json() as ReleaseInfo;
  expect(release.source_sha).toBe(expectedSourceSha);
  expect(release.base_path).toBe(new URL(baseUrl!).pathname);
  expect(release.stage).toBe(deploymentStage);
  expect(release.wasm.length).toBeGreaterThan(0);

  const observed: Awaited<ReturnType<typeof responseEvidence>>[] = [
    await responseEvidence(appResponse),
    await responseEvidence(releaseResponse),
  ];
  for (const wasm of release.wasm) {
    const wasmResponse = await request.get(new URL(wasm.url, baseUrl!).toString());
    expect(wasmResponse.status()).toBe(200);
    expect(wasmResponse.headers()["content-type"]).toContain("application/wasm");
    const bytes = await wasmResponse.body();
    expect(bytes.byteLength).toBe(wasm.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(wasm.sha256);
    observed.push(await responseEvidence(wasmResponse));
  }

  if (deploymentStage === "preview") {
    const rootPreview = await request.get(new URL("/ruby-playground/", baseUrl!).toString());
    expect(rootPreview.status()).toBe(200);
    const rootHtml = await rootPreview.text();
    expect(rootHtml).toContain("data-pages-preview-noindex");
    expect(rootHtml).toContain("Preview is being prepared");
    observed.push(await responseEvidence(rootPreview));
  }

  const unknownPath = new URL("__pages_deployed_unknown_path__", baseUrl!).toString();
  const unknownResponse = await request.get(unknownPath);
  expect(unknownResponse.status()).toBe(404);
  observed.push(await responseEvidence(unknownResponse));

  const browserResponses: Promise<void>[] = [];
  page.on("response", (response) => {
    if (/\.(?:js|wasm)(?:\?|$)/i.test(response.url()) || /worker/i.test(response.url())) {
      browserResponses.push((async () => {
        const contentType = response.headers()["content-type"] ?? "";
        if (/\.wasm(?:\?|$)/i.test(response.url())) {
          expect(contentType).toContain("application/wasm");
        } else {
          expect(contentType).toMatch(/javascript|ecmascript/i);
        }
        observed.push(await responseEvidence(response));
      })());
    }
  });
  await page.goto(baseUrl!);
  await expect(page.getByRole("heading", { name: "Ruby Playground" })).toBeVisible();
  await Promise.all(browserResponses);

  await testInfo.attach("deployed-http-observations.json", {
    body: Buffer.from(`${JSON.stringify({
      source_sha: expectedSourceSha,
      stage: deploymentStage,
      observed,
    }, null, 2)}\n`),
    contentType: "application/json",
  });
});

test("long shared URL stays within the host limit and does not auto-run", async ({
  page,
}) => {
  await page.goto(baseUrl!);
  await expect(page.getByRole("heading", { name: "Ruby Playground" })).toBeVisible();
  const source = `# ${randomBytes(5_500).toString("base64url")}`;
  const editor = page.getByRole("textbox", { name: "Ruby source" });
  await page.locator(".monaco-editor .view-lines").click();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
  await page.getByRole("button", { name: "URL を共有" }).click();
  const sharedUrl = await page.getByRole("textbox", { name: "共有 URL" }).inputValue();
  expect(Buffer.byteLength(sharedUrl, "utf8")).toBeLessThanOrEqual(8_000);

  await page.goto(sharedUrl);
  await expect(page.getByRole("status")).toHaveText("実行待ち");
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("実行待ち");
});
