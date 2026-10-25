import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { editRuby, expectRubyOutput } from "./editor";
import {
  expectSharedCodePending,
  observeRubyWorkers,
  SHARED_CODE_CONSENT,
} from "./shared-code";

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

type ResponseHeader = { name: string; value: string };
type ResponseEvidence = {
  source: "APIRequestContext" | "Chromium page response";
  url: string;
  status: number;
  headers: ResponseHeader[];
  bodyBufferBytes: number | null;
  bodyBufferBytesNote: string;
  encodedResponseBodyBytes: number | null;
  responseHeadersBytes: number | null;
  httpResponseBytes: number | null;
  transferBytesNote: string;
  browserDecodedBodyBytes: number | null;
  browserDecodedBodyBytesNote: string;
  securityHeaders: Record<string, { present: boolean; value: string | null }>;
  contentType: string | null;
  contentEncoding: string | null;
  cacheControl: string | null;
  contentLengthHeader: string | null;
};

function responseEvidence(
  source: ResponseEvidence["source"],
  url: string,
  status: number,
  headers: ResponseHeader[],
  bodyBufferBytes: number | null,
  bodyBufferBytesNote: string,
  encodedResponseBodyBytes: number | null,
  responseHeadersBytes: number | null,
  transferBytesNote: string,
  browserDecodedBodyBytes: number | null,
  browserDecodedBodyBytesNote: string,
) {
  const byName = Object.fromEntries(headers.map(({ name, value }) => [name.toLowerCase(), value]));
  const securityHeaderNames = [
    "content-security-policy",
    "referrer-policy",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
  ];
  const httpResponseBytes = encodedResponseBodyBytes === null || responseHeadersBytes === null
    ? null
    : encodedResponseBodyBytes + responseHeadersBytes;
  return {
    source,
    url,
    status,
    headers,
    contentType: byName["content-type"] ?? null,
    contentEncoding: byName["content-encoding"] ?? null,
    cacheControl: byName["cache-control"] ?? null,
    contentLengthHeader: byName["content-length"] ?? null,
    securityHeaders: Object.fromEntries(securityHeaderNames.map((name) => [
      name,
      { present: Object.hasOwn(byName, name), value: byName[name] ?? null },
    ])),
    bodyBufferBytes,
    bodyBufferBytesNote,
    encodedResponseBodyBytes,
    responseHeadersBytes,
    httpResponseBytes,
    transferBytesNote,
    browserDecodedBodyBytes,
    browserDecodedBodyBytesNote,
  };
}

function apiResponseEvidence(
  response: {
    url(): string;
    status(): number;
    headersArray(): ResponseHeader[];
  },
  bodyBufferBytes: number | null,
  bodyBufferBytesNote: string,
) {
  return responseEvidence(
    "APIRequestContext",
    response.url(),
    response.status(),
    response.headersArray(),
    bodyBufferBytes,
    bodyBufferBytesNote,
    null,
    null,
    "APIRequestContext does not expose encoded network response sizes; do not infer transfer size from its body buffer.",
    null,
    "No browser-decoded body measurement was made for this API response.",
  );
}

async function browserResponseEvidence(response: {
  url(): string;
  status(): number;
  allHeaders(): Promise<Record<string, string>>;
  finished(): Promise<null | Error>;
  request(): {
    sizes(): Promise<{
      responseBodySize: number;
      responseHeadersSize: number;
    }>;
  };
}) {
  const responseError = await response.finished();
  expect(responseError, `HTTP response failed: ${response.url()}`).toBeNull();
  const [headers, sizes] = await Promise.all([
    response.allHeaders(),
    response.request().sizes(),
  ]);
  return responseEvidence(
    "Chromium page response",
    response.url(),
    response.status(),
    Object.entries(headers).map(([name, value]) => ({ name, value })),
    null,
    "Browser Response.body() is intentionally not read; decoded browser body bytes are unknown.",
    sizes.responseBodySize,
    sizes.responseHeadersSize,
    "Measured by Playwright Request.sizes() after response.finished().",
    null,
    "Not measured; no browser response body was read.",
  );
}

test("published entry and WASM metadata match the requested release", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
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

  const robotsTags = html.match(/<meta\s+name=["']robots["'][^>]*>/gi) ?? [];
  if (deploymentStage === "preview") {
    const previewRobotsTag = robotsTags.find((tag) =>
      tag.includes("data-pages-preview-noindex"),
    );
    expect(previewRobotsTag).toContain("noindex,nofollow");
  } else {
    expect(robotsTags.join(" ")).not.toMatch(/noindex/i);
  }

  const releaseResponse = await request.get(new URL("release-info.json", baseUrl!).toString());
  expect(releaseResponse.status()).toBe(200);
  const release = await releaseResponse.json() as ReleaseInfo;
  expect(release.source_sha).toBe(expectedSourceSha);
  expect(release.base_path).toBe(new URL(baseUrl!).pathname);
  expect(release.stage).toBe(deploymentStage);
  expect(release.wasm).toHaveLength(3);
  expect(new Set(release.wasm.map(({ sha256 }) => sha256)).size).toBe(3);

  const observed: ReturnType<typeof responseEvidence>[] = [
    apiResponseEvidence(
      appResponse,
      null,
      "HTML was inspected as text; its API body-buffer length was not measured.",
    ),
    apiResponseEvidence(
      releaseResponse,
      null,
      "Manifest was parsed as JSON; its API body-buffer length was not measured.",
    ),
  ];
  for (const wasm of release.wasm) {
    const wasmResponse = await request.get(new URL(wasm.url, baseUrl!).toString());
    expect(wasmResponse.status()).toBe(200);
    expect(wasmResponse.headers()["content-type"]).toContain("application/wasm");
    const bytes = await wasmResponse.body();
    expect(bytes.byteLength).toBe(wasm.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(wasm.sha256);
    observed.push(apiResponseEvidence(
      wasmResponse,
      bytes.byteLength,
      "APIResponse body buffer used for exact manifest byte-count/SHA-256 verification; this is not encoded HTTP transfer size.",
    ));
  }

  if (deploymentStage === "preview") {
    const rootPreview = await request.get(new URL("/ruby-playground/", baseUrl!).toString());
    expect(rootPreview.status()).toBe(200);
    const rootHtml = await rootPreview.text();
    expect(rootHtml).toContain("data-pages-preview-noindex");
    expect(rootHtml).toContain("Preview is being prepared");
    observed.push(apiResponseEvidence(
      rootPreview,
      null,
      "Root preview HTML was inspected as text; its API body-buffer length was not measured.",
    ));
  }

  const unknownPath = new URL("__pages_deployed_unknown_path__", baseUrl!).toString();
  const unknownResponse = await request.get(unknownPath);
  expect(unknownResponse.status()).toBe(404);
  observed.push(apiResponseEvidence(
    unknownResponse,
    null,
    "404 body buffer was not measured.",
  ));

  const browserResponseJobs: Promise<void>[] = [];
  const browserResponseErrors: string[] = [];
  const browserResourceUrls: string[] = [];
  page.on("response", (response) => {
    if (/\.(?:js|wasm)(?:\?|$)/i.test(response.url()) || /worker/i.test(response.url())) {
      const job = (async () => {
        browserResourceUrls.push(response.url());
        expect(response.status(), `HTTP status for ${response.url()}`).toBe(200);
        const headers = await response.allHeaders();
        const contentType = headers["content-type"] ?? "";
        if (/\.wasm(?:\?|$)/i.test(response.url())) {
          expect(contentType).toContain("application/wasm");
        } else {
          expect(contentType).toMatch(/javascript|ecmascript/i);
        }
        observed.push(await browserResponseEvidence(response));
      })().catch((error: unknown) => {
        browserResponseErrors.push(`${response.url()}: ${String(error)}`);
      });
      browserResponseJobs.push(job);
    }
  });
  const browserDocumentResponse = await page.goto(baseUrl!);
  await expect(page.getByRole("heading", { name: "Ruby Playground" })).toBeVisible();
  if (browserDocumentResponse) {
    expect(browserDocumentResponse.status()).toBe(200);
    observed.push(await browserResponseEvidence(browserDocumentResponse));
  }
  // Finish the initial automatic run before collecting a second run's responses.
  // Canceling its in-flight WASM fetch would make HTTP evidence intentionally incomplete.
  await expectRubyOutput(page, "Hello, Ruby!\nRuby 1\nRuby 2\nRuby 3\n");
  await editRuby(page, 'puts "Pages deployed smoke #{RUBY_VERSION}"');
  await expectRubyOutput(page, /^Pages deployed smoke 4\.0\.\d+\n$/);
  await page.waitForLoadState("networkidle");
  const responseJobCountAtNetworkIdle = browserResponseJobs.length;
  await Promise.all(browserResponseJobs);
  expect(browserResponseJobs).toHaveLength(responseJobCountAtNetworkIdle);
  expect(browserResponseErrors, "Browser response evidence collection errors").toEqual([]);
  expect(browserResourceUrls.some((url) => /\.js(?:\?|$)/i.test(url))).toBe(true);
  expect(browserResourceUrls.some((url) => /worker/i.test(url))).toBe(true);
  expect(browserResourceUrls.some((url) => /\.wasm(?:\?|$)/i.test(url))).toBe(true);

  await testInfo.attach("deployed-http-observations.json", {
    body: Buffer.from(`${JSON.stringify({
      source_sha: expectedSourceSha,
      stage: deploymentStage,
      observed,
    }, null, 2)}\n`),
    contentType: "application/json",
  });
});

test("long shared URL stays within the host limit and restores code and version without running before consent", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(baseUrl!);
  await expect(page.getByRole("heading", { name: "Ruby Playground" })).toBeVisible();
  let state = 0x93c0ffee;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let payload = "";
  for (let index = 0; index < 3_000; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    payload += alphabet[state & 63];
  }
  const source = `# ${payload}\nputs "long shared #{RUBY_VERSION}"`;
  await page.getByLabel("Ruby バージョン").selectOption("3.3");
  await editRuby(page, source);
  await page.getByRole("button", { name: "URL を共有" }).click();
  const sharedUrl = await page.getByRole("textbox", { name: "共有 URL" }).inputValue();
  const sharedUrlBytes = Buffer.byteLength(sharedUrl, "utf8");
  expect(sharedUrlBytes).toBeGreaterThan(4_000);
  expect(sharedUrlBytes).toBeLessThanOrEqual(8_000);

  await expectRubyOutput(page, /^long shared 3\.3\.\d+\n$/);
  const rubyWorkers = observeRubyWorkers(page);
  for (const navigate of [() => page.goto(sharedUrl), () => page.reload()]) {
    const previousWorkerCount = rubyWorkers.length;
    await navigate();
    await expect(page.getByLabel("Ruby バージョン")).toHaveValue("3.3");
    await expect(page.locator(".monaco-editor .view-lines")).toContainText(
      source.slice(0, 80),
    );
    await expectSharedCodePending(page, rubyWorkers, previousWorkerCount);
    await page.getByRole("button", { name: SHARED_CODE_CONSENT }).click();
    await expectRubyOutput(page, /^long shared 3\.3\.\d+\n$/);
    await expect(
      page.getByRole("button", { name: SHARED_CODE_CONSENT }),
    ).toHaveCount(0);
  }
});
