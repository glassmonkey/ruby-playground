import { expect, test, type Page } from "@playwright/test";
import { editRuby, expectRubyOutput } from "./editor";
import { buildShareUrl } from "../src/share";

type CompletionDiagnosticWindow = Window & {
  __analysisWorkerUrls?: string[];
  __lspObservations?: Array<Record<string, unknown>>;
  __lspTerminationEvents?: Array<{ url: string; at: number }>;
};

async function watchAnalysisWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const diagnosticWindow = window as unknown as CompletionDiagnosticWindow;
    const urls: string[] = [];
    const observations: Array<Record<string, unknown>> = [];
    const terminationEvents = JSON.parse(
      sessionStorage.getItem("completion-worker-terminations") ?? "[]",
    ) as Array<{ url: string; at: number }>;
    diagnosticWindow.__analysisWorkerUrls = urls;
    diagnosticWindow.__lspObservations = observations;
    diagnosticWindow.__lspTerminationEvents = terminationEvents;
    const NativeWorker = window.Worker;
    const InstrumentedWorker = function (
      url: string | URL,
      options?: WorkerOptions,
    ) {
      const resolvedUrl = new URL(url, window.location.href);
      if (/\/worker-[^/]+\.js$/.test(resolvedUrl.pathname)) {
        urls.push(resolvedUrl.pathname);
        const worker = new NativeWorker(url, options);
        const pending = new Map<number, { method: string; startedAt: number }>();
        const nativePostMessage = worker.postMessage.bind(worker);
        const nativeTerminate = worker.terminate.bind(worker);
        worker.terminate = (() => {
          terminationEvents.push({
            url: resolvedUrl.pathname,
            at: performance.now(),
          });
          sessionStorage.setItem(
            "completion-worker-terminations",
            JSON.stringify(terminationEvents),
          );
          nativeTerminate();
        }) as typeof worker.terminate;
        worker.postMessage = ((message: unknown, transfer?: Transferable[]) => {
          const request = message as {
            type?: string;
            target?: string;
            token?: number;
            message?: {
              method?: string;
              params?: {
                textDocument?: { version?: number };
                position?: unknown;
              };
            };
          };
          if (request.type === "initialize") {
            observations.push({ direction: "initialize", target: request.target });
          } else if (request.type === "request" && typeof request.token === "number") {
            const method = request.message?.method ?? "unknown";
            const startedAt = performance.now();
            pending.set(request.token, { method, startedAt });
            observations.push({
              direction: "request",
              token: request.token,
              method,
              documentVersion: request.message?.params?.textDocument?.version,
              position: request.message?.params?.position,
            });
          }
          if (transfer) nativePostMessage(message, transfer);
          else nativePostMessage(message);
        }) as typeof worker.postMessage;
        worker.addEventListener("message", (event: MessageEvent<unknown>) => {
          const response = event.data as {
            type?: string;
            version?: string;
            wasmSha256?: string;
            timings?: unknown;
            token?: number;
            elapsedMs?: number;
            responses?: Array<{
              id?: number;
              result?: unknown;
              error?: unknown;
            }>;
            error?: string;
          };
          if (response.type === "ready" || response.type === "fatal") {
            observations.push({
              direction: response.type,
              version: response.version,
              wasmSha256: response.wasmSha256,
              timings: response.timings,
              error: response.error,
            });
            return;
          }
          if (response.type !== "response" || typeof response.token !== "number")
            return;
          const request = pending.get(response.token);
          if (!request) return;
          pending.delete(response.token);
          const rpc = response.responses?.find((entry) => "id" in entry);
          const result = rpc?.result as
            | {
                items?: Array<{
                  label?: string | { label?: string };
                  kind?: number;
                  detail?: string;
                  textEdit?: unknown;
                }>;
                signatures?: Array<{ label?: string }>;
              }
            | Array<{
                label?: string | { label?: string };
                kind?: number;
                detail?: string;
                textEdit?: unknown;
              }>
            | undefined;
          const rawItems = Array.isArray(result)
            ? result
            : Array.isArray(result?.items)
              ? result.items
              : [];
          observations.push({
            direction: "response",
            token: response.token,
            method: request.method,
            responseMs: performance.now() - request.startedAt,
            workerElapsedMs: response.elapsedMs,
            candidateCount: rawItems.length,
            candidates: rawItems.map((item) => ({
              label:
                typeof item.label === "string"
                  ? item.label
                  : item.label?.label,
              kind: item.kind,
              detail: item.detail,
              textEdit: item.textEdit,
            })),
            signatures:
              !Array.isArray(result) && Array.isArray(result?.signatures)
                ? result.signatures.map((signature) => signature.label)
                : undefined,
          });
        });
        return worker;
      }
      return new NativeWorker(url, options);
    } as unknown as typeof Worker;
    InstrumentedWorker.prototype = NativeWorker.prototype;
    window.Worker = InstrumentedWorker;
  });
}

async function analysisWorkerUrls(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as CompletionDiagnosticWindow)
        .__analysisWorkerUrls ?? [],
  );
}

async function lspObservations(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    () =>
      (window as unknown as CompletionDiagnosticWindow).__lspObservations ?? [],
  );
}

async function analysisWorkerTerminations(
  page: Page,
): Promise<Array<{ url: string; at: number }>> {
  return page.evaluate(
    () =>
      (window as unknown as CompletionDiagnosticWindow)
        .__lspTerminationEvents ?? [],
  );
}

function latestRawCompletion(events: Array<Record<string, unknown>>) {
  const event = events
    .filter(
      (entry) =>
        entry.direction === "response" &&
        entry.method === "textDocument/completion",
    )
    .at(-1);
  return event
    ? (event.candidates as Array<{
        label?: string;
        kind?: number;
        detail?: string;
        textEdit?: unknown;
      }>)
    : [];
}

test("language server completions insert and execute in the browser", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await editRuby(page, 'puts "hello"');
  await page.keyboard.type(".upc");
  const suggestions = page.getByRole("listbox", { name: "Suggest" });
  await expect(suggestions).toBeVisible({ timeout: 30_000 });
  const upcase = suggestions.getByRole("listitem", {
    name: "upcase, Method",
    exact: true,
  });
  await expect(upcase).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("upcase-candidate.png") });
  await upcase.click();
  await expect(page.locator(".monaco-editor .view-lines")).toHaveText(
    'puts "hello".upcase',
  );
  await expectRubyOutput(page, "HELLO\n");
  await page.screenshot({ path: testInfo.outputPath("upcase-inserted.png") });

  await editRuby(page, 'greeting = "hi"\nputs ');
  await page.keyboard.type("gree");
  const greetingSuggestions = page.getByRole("listbox", { name: "Suggest" });
  await expect(greetingSuggestions).toBeVisible({ timeout: 30_000 });
  const greeting = greetingSuggestions.getByRole("listitem", {
    name: "greeting, Variable",
    exact: true,
  });
  await expect(greeting).toBeVisible({ timeout: 30_000 });
  await greeting.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText([
    'greeting = "hi"',
    "puts greeting",
  ]);
  await expectRubyOutput(page, "hi\n");
  await page.screenshot({ path: testInfo.outputPath("greeting-inserted.png") });
});

test("analysis failure leaves editing and Ruby execution available", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route("**/lsp/manifest.json**", (route) => route.abort());
  await page.goto("./");
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await editRuby(page, 'puts "editor and execution remain available"');
  await expectRubyOutput(page, "editor and execution remain available\n");

  await page.locator('label[for="completion-enabled"]').click();
  await expect(page).toHaveURL(/(?:\?|&)ac=0(?:&|$)/);
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await page.locator('label[for="completion-enabled"]').click();
  await expect(page).not.toHaveURL(/(?:\?|&)ac=0(?:&|$)/);
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const codeOnlyHistoryUrl = buildShareUrl(page.url(), {
    code: 'puts "code-only navigation after completion error"',
    version: "4.0",
    completionEnabled: true,
  });
  await page.evaluate((url) => {
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, codeOnlyHistoryUrl);
  await expect(
    page.getByText("Unavailable", { exact: true }),
  ).toBeVisible();
  await expectRubyOutput(page, "code-only navigation after completion error\n");
});

test("code-only history navigation preserves ready completion and natural suggestions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await watchAnalysisWorkers(page);
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  const codeOnlyHistoryUrl = buildShareUrl(page.url(), {
    code: 'greeting = "hi"\nputs ',
    version: "4.0",
    completionEnabled: true,
  });
  await page.evaluate((url) => {
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, codeOnlyHistoryUrl);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    'greeting = "hi"',
  );
  await expect(page.getByText("On", { exact: true })).toBeVisible();
  expect(await analysisWorkerUrls(page)).toHaveLength(1);

  await editRuby(page, 'greeting = "hi"\nputs ');
  await page.keyboard.type("gree");
  const greeting = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "greeting, Variable", exact: true });
  await expect(greeting).toBeVisible({ timeout: 30_000 });
  await greeting.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText([
    'greeting = "hi"',
    "puts greeting",
  ]);
  await expectRubyOutput(page, "hi\n");
  expect(await analysisWorkerUrls(page)).toHaveLength(1);
  expect(
    (await lspObservations(page)).filter(
      (observation) => observation.direction === "initialize",
    ),
  ).toHaveLength(1);
});

test("natural input completes put as puts and preserves text after the edit", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await editRuby(page, 'put "Ruby"');
  for (let index = 0; index < 7; index += 1)
    await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("s");
  const puts = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "puts, Method", exact: true });
  await expect(puts).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("puts-candidate.png") });
  await puts.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    'puts "Ruby"',
  );
  await expectRubyOutput(page, "Ruby\n");
  await page.screenshot({ path: testInfo.outputPath("puts-inserted.png") });

  await editRuby(page, 'puts "hello" + "!"');
  for (let index = 0; index < 6; index += 1)
    await page.keyboard.press("ArrowLeft");
  await page.keyboard.type(".upc");
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    'puts "hello".upc + "!"',
  );
  await page.screenshot({ path: testInfo.outputPath("midline-prefix-input.png") });
  const upcase = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "upcase, Method", exact: true });
  await expect(upcase).toBeVisible({ timeout: 30_000 });
  await upcase.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    'puts "hello".upcase + "!"',
  );
  await expectRubyOutput(page, "HELLO!\n");
  await page.screenshot({ path: testInfo.outputPath("midline-suffix-preserved.png") });
});

test("natural input completion handles Japanese identifiers and emoji UTF-16 positions", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await editRuby(page, 'puts "😀"');
  await page.keyboard.type(".upc");
  const upcase = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "upcase, Method", exact: true });
  await expect(upcase).toBeVisible({ timeout: 30_000 });
  await upcase.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    'puts "😀".upcase',
  );
  await expectRubyOutput(page, "😀\n");
  await page.screenshot({ path: testInfo.outputPath("emoji-utf16-inserted.png") });

  await editRuby(page, '名前 = "Ruby"\nputs ');
  await page.keyboard.type("名");
  const variable = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "名前, Variable", exact: true });
  await expect(variable).toBeVisible({ timeout: 30_000 });
  await variable.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText([
    '名前 = "Ruby"',
    "puts 名前",
  ]);
  await expectRubyOutput(page, "Ruby\n");
  await page.screenshot({ path: testInfo.outputPath("japanese-variable-inserted.png") });
});

test("Mine#rfind and Array#rfind remain distinct after declaration removal", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await editRuby(page, 'class Mine; def rfind; "custom"; end; end\nputs Mine.new.r');
  await page.keyboard.type("f");
  const customMethod = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "rfind, Method", exact: true });
  await expect(customMethod).toBeVisible({ timeout: 30_000 });
  await customMethod.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText([
    'class Mine; def rfind; "custom"; end; end',
    "puts Mine.new.rfind",
  ]);
  await expectRubyOutput(page, "custom\n");
  await page.screenshot({ path: testInfo.outputPath("mine-rfind-inserted.png") });

  await editRuby(page, 'puts [1,2].');
  await page.keyboard.type("rf");
  const arrayMethod = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "rfind, Method", exact: true });
  await expect(arrayMethod).toBeVisible({ timeout: 30_000 });
  await arrayMethod.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    "puts [1,2].rfind",
  );
  await page.screenshot({ path: testInfo.outputPath("array-rfind-after-deletion.png") });
});

test("Ruby API completions track 3.3 to 4.0 to 3.3 and expose raw item metadata", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await watchAnalysisWorkers(page);
  await page.goto("./?v=3.3");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  const rfind = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "rfind, Method", exact: true });
  const yieldItem = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "yield, Method", exact: true });
  const raiseItem = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "raise, Method", exact: true });

  let responseCount = (await lspObservations(page)).filter(
    (event) => event.direction === "response" && event.method === "textDocument/completion",
  ).length;
  await editRuby(page, "Ractor.");
  await page.keyboard.type("yi");
  await expect(yieldItem).toBeVisible({ timeout: 30_000 });
  let rawItems = latestRawCompletion(await lspObservations(page));
  expect(rawItems.some((item) => item.label === "yield" && item.textEdit)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("ruby-3.3-ractor-yield.png") });
  await yieldItem.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText("Ractor.yield");

  responseCount = (await lspObservations(page)).filter(
    (event) => event.direction === "response" && event.method === "textDocument/completion",
  ).length;
  await editRuby(page, "puts [1,2].");
  await page.keyboard.type("rf");
  await expect
    .poll(
      async () =>
        (await lspObservations(page)).filter(
          (event) =>
            event.direction === "response" &&
            event.method === "textDocument/completion",
        ).length,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(responseCount);
  rawItems = latestRawCompletion(await lspObservations(page));
  expect(rawItems.some((item) => item.label === "rfind")).toBe(false);
  await expect(rfind).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("ruby-3.3-rfind-absent.png") });

  await page.getByLabel("Ruby version").selectOption("4.0");
  await expect(page.getByLabel("Ruby version")).toHaveValue("4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  responseCount = (await lspObservations(page)).filter(
    (event) => event.direction === "response" && event.method === "textDocument/completion",
  ).length;
  await editRuby(page, "Ractor.");
  await page.keyboard.type("yi");
  await expect
    .poll(
      async () =>
        (await lspObservations(page)).filter(
          (event) =>
            event.direction === "response" &&
            event.method === "textDocument/completion",
        ).length,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(responseCount);
  rawItems = latestRawCompletion(await lspObservations(page));
  expect(rawItems.some((item) => item.label === "yield")).toBe(false);
  await expect(yieldItem).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("ruby-4.0-ractor-yield-absent.png") });

  responseCount = (await lspObservations(page)).filter(
    (event) => event.direction === "response" && event.method === "textDocument/completion",
  ).length;
  await editRuby(page, "puts [1,2].");
  await page.keyboard.type("rf");
  await expect(rfind).toBeVisible({ timeout: 30_000 });
  rawItems = latestRawCompletion(await lspObservations(page));
  const rawRfind = rawItems.find((item) => item.label === "rfind");
  expect(rawRfind?.textEdit).toBeDefined();
  await page.screenshot({ path: testInfo.outputPath("ruby-4.0-rfind.png") });
  await rfind.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    "puts [1,2].rfind",
  );

  await editRuby(page, "puts Fiber.new.");
  await page.keyboard.type("rai");
  await expect(raiseItem).toBeVisible({ timeout: 30_000 });
  rawItems = latestRawCompletion(await lspObservations(page));
  const rawRaise40 = rawItems.find((item) => item.label === "raise");
  expect(rawRaise40?.textEdit).toBeDefined();
  await page.screenshot({ path: testInfo.outputPath("ruby-4.0-fiber-raise.png") });

  await page.getByLabel("Ruby version").selectOption("3.3");
  await expect(page.getByLabel("Ruby version")).toHaveValue("3.3");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  responseCount = (await lspObservations(page)).filter(
    (event) => event.direction === "response" && event.method === "textDocument/completion",
  ).length;
  await editRuby(page, "puts [1,2].");
  await page.keyboard.type("rf");
  await expect
    .poll(
      async () =>
        (await lspObservations(page)).filter(
          (event) =>
            event.direction === "response" &&
            event.method === "textDocument/completion",
        ).length,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(responseCount);
  rawItems = latestRawCompletion(await lspObservations(page));
  expect(rawItems.some((item) => item.label === "rfind")).toBe(false);
  await expect(rfind).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("ruby-3.3-rfind-restored-absent.png") });

  await editRuby(page, "puts Fiber.new.");
  await page.keyboard.type("rai");
  await expect(raiseItem).toBeVisible({ timeout: 30_000 });
  rawItems = latestRawCompletion(await lspObservations(page));
  const rawRaise33 = rawItems.find((item) => item.label === "raise");
  expect(rawRaise33?.textEdit).toBeDefined();
  await page.screenshot({ path: testInfo.outputPath("ruby-3.3-fiber-raise.png") });

  const observations = await lspObservations(page);
  const protocolMethods = observations
    .filter((event) => event.direction === "request")
    .map((event) => event.method);
  await testInfo.attach("lsp-protocol.json", {
    body: JSON.stringify(
      {
        observations,
        signatures: {
          ruby33FiberRaiseDetail: rawRaise33?.detail,
          ruby40FiberRaiseDetail: rawRaise40?.detail,
        },
        protocolMethods,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("measure cold and warm completion startup, response, and HTTP asset transfer", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await watchAnalysisWorkers(page);
  const httpAssetResponses: Promise<Record<string, unknown>>[] = [];
  page.context().on("requestfinished", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/lsp/")) return;
    httpAssetResponses.push(
      (async () => {
        const response = await request.response();
        const headers = response ? await response.allHeaders() : {};
        const sizes = await request.sizes();
        return {
          path: url.pathname,
          status: response?.status(),
          contentLength: headers["content-length"],
          contentEncoding: headers["content-encoding"],
          responseBodyBytes: sizes.responseBodySize,
          responseHeadersBytes: sizes.responseHeadersSize,
        };
      })().catch((error: unknown) => ({
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      })),
    );
  });
  const navigationStartedAt = Date.now();
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const coldReadyMs = Date.now() - navigationStartedAt;

  await editRuby(page, 'puts "cold"');
  const coldQueryStartedAt = Date.now();
  await page.keyboard.type(".upc");
  const coldCandidate = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "upcase, Method", exact: true });
  await expect(coldCandidate).toBeVisible({ timeout: 30_000 });
  const coldCandidateUiMs = Date.now() - coldQueryStartedAt;
  await coldCandidate.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    'puts "cold".upcase',
  );
  await expectRubyOutput(page, "COLD\n");
  await page.screenshot({ path: testInfo.outputPath("cold-upcase-inserted.png") });

  await editRuby(page, 'puts "warm"');
  const warmQueryStartedAt = Date.now();
  await page.keyboard.type(".upc");
  const warmCandidate = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "upcase, Method", exact: true });
  await expect(warmCandidate).toBeVisible({ timeout: 30_000 });
  const warmCandidateUiMs = Date.now() - warmQueryStartedAt;
  await warmCandidate.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    'puts "warm".upcase',
  );
  await expectRubyOutput(page, "WARM\n");
  await page.screenshot({ path: testInfo.outputPath("warm-upcase-inserted.png") });

  const observations = await lspObservations(page);
  const httpAssets = await Promise.all(httpAssetResponses);
  const completions = observations
    .filter(
      (event) =>
        event.direction === "response" &&
        event.method === "textDocument/completion",
    )
    .map((event) => ({
      responseMs: event.responseMs,
      workerElapsedMs: event.workerElapsedMs,
      candidateCount: event.candidateCount,
    }));
  const ready = observations.filter((event) => event.direction === "ready");
  const metrics = {
    head: "f55a5ee4f0b9621aaccdb00b3e4c0be5df2f16b3",
    version: "4.0",
    manifestSha256:
      "c93e49dc7769caf55ff2e14a70af56a042bfaa894b956b944db44d715edc3e13",
    wasmSha256:
      "913e37a91777a0e9e5ef6114eb0b3dc8e1d3ac990a15c144c6a0afc606daae5c",
    coldReadyMs,
    coldCandidateUiMs,
    warmCandidateUiMs,
    workerReady: ready,
    completionResponses: completions,
    httpAssets,
  };
  await testInfo.attach("browser-metrics.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});

test("OFF and Ruby version changes dispose and recreate analysis workers", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await watchAnalysisWorkers(page);
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await editRuby(page, 'puts "hello"');
  await page.keyboard.type(".upc");
  const upcase = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "upcase, Method", exact: true });
  await expect(upcase).toBeVisible({ timeout: 30_000 });
  await upcase.click();
  await expectRubyOutput(page, "HELLO\n");

  const completionToggle = page.locator('label[for="completion-enabled"]');
  await completionToggle.click();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Suggest" })).toBeHidden();
  await expect.poll(async () => (await analysisWorkerTerminations(page)).length).toBe(1);
  await expectRubyOutput(page, "HELLO\n");
  await page.screenshot({ path: testInfo.outputPath("off-disposed-worker.png") });

  await completionToggle.click();
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(async () => (await analysisWorkerUrls(page)).length).toBe(2);

  await page.getByLabel("Ruby version").selectOption("3.4");
  await expect(page.getByLabel("Ruby version")).toHaveValue("3.4");
  await expect(
    page.getByText("Unavailable for Ruby 3.4", { exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await analysisWorkerTerminations(page)).length).toBe(2);
  expect(await analysisWorkerUrls(page)).toHaveLength(2);
  await expect(page.getByRole("listbox", { name: "Suggest" })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("unsupported-disposed-worker.png") });

  await page.getByLabel("Ruby version").selectOption("3.3");
  await expect(page.getByLabel("Ruby version")).toHaveValue("3.3");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(async () => (await analysisWorkerUrls(page)).length).toBe(3);
  await editRuby(page, 'puts "worker recreated"');
  await expectRubyOutput(page, "worker recreated\n");
  await page.screenshot({ path: testInfo.outputPath("worker-recreated-3.3.png") });

  await testInfo.attach("lifecycle.json", {
    body: JSON.stringify(
      {
        workerUrls: await analysisWorkerUrls(page),
        terminations: await analysisWorkerTerminations(page),
        observations: await lspObservations(page),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("natural input with no matching completion leaves text and execution intact", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await editRuby(page, 'puts "hello".');
  await page.keyboard.type("unknownMethodPrefix");
  await expect(page.getByRole("listbox", { name: "Suggest" })).toBeHidden({
    timeout: 10_000,
  });
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    'puts "hello".unknownMethodPrefix',
  );
  await page.screenshot({ path: testInfo.outputPath("no-matching-completion.png") });
  await expect(page.getByRole("status")).toHaveText("Error");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "undefined method 'unknownMethodPrefix'",
  );
});

test("completion OFF skips analysis assets on first load, reload, and history navigation", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await watchAnalysisWorkers(page);
  const analysisAssetRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/lsp/")) analysisAssetRequests.push(pathname);
  });

  const baseURL = testInfo.project.use.baseURL as string;
  const offURL = buildShareUrl(baseURL, {
    code: 'puts "completion off"',
    version: "3.3",
    completionEnabled: false,
  });
  const onURL = buildShareUrl(baseURL, {
    code: 'puts "completion on"',
    version: "3.3",
    completionEnabled: true,
  });

  await page.goto(offURL);
  await expect(page.getByRole("checkbox", { name: "Code completion" })).not.toBeChecked();
  await expectRubyOutput(page, "completion off\n");
  await page.screenshot({ path: testInfo.outputPath("completion-off.png") });
  expect(new URL(page.url()).searchParams.get("ac")).toBe("0");
  expect(await analysisWorkerUrls(page)).toEqual([]);
  expect(analysisAssetRequests).toEqual([]);

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Code completion" })).not.toBeChecked();
  await expectRubyOutput(page, "completion off\n");
  expect(await analysisWorkerUrls(page)).toEqual([]);
  expect(analysisAssetRequests).toEqual([]);

  await page.goto(onURL);
  await expect(page.getByRole("checkbox", { name: "Code completion" })).toBeChecked();
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expectRubyOutput(page, "completion on\n");
  await page.screenshot({ path: testInfo.outputPath("completion-on.png") });
  expect(await analysisWorkerUrls(page)).toHaveLength(1);
  expect(analysisAssetRequests).toContain("/lsp/manifest.json");

  await page.goBack();
  await expect(page.getByRole("checkbox", { name: "Code completion" })).not.toBeChecked();
  await expectRubyOutput(page, "completion off\n");
  expect(new URL(page.url()).searchParams.get("ac")).toBe("0");
  expect(await analysisWorkerUrls(page)).toEqual([]);

  await page.goForward();
  await expect(page.getByRole("checkbox", { name: "Code completion" })).toBeChecked();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "completion on",
  );
});

test("all unsupported Ruby versions keep execution available without analysis assets", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await watchAnalysisWorkers(page);
  const analysisRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/lsp/"))
      analysisRequests.push(request.url());
  });

  for (const [version, patch] of [
    ["3.2", "3.2.4"],
    ["3.4", "3.4.1"],
    ["4.1", "4.1.0"],
  ]) {
    await page.goto(`./?v=${version}`);
    await expect(page.getByLabel("Ruby version")).toHaveValue(version);
    await expect(
      page.getByText(`Unavailable for Ruby ${version}`, { exact: true }),
    ).toBeVisible();
    await editRuby(page, "puts RUBY_VERSION");
    await expectRubyOutput(page, `${patch}\n`);
    await page.screenshot({
      path: testInfo.outputPath(`completion-unavailable-${version}.png`),
    });
    await page.locator('label[for="completion-enabled"]').click();
    await page.locator('label[for="completion-enabled"]').click();
    await expect(
      page.getByText(`Unavailable for Ruby ${version}`, { exact: true }),
    ).toBeVisible();
    expect(await analysisWorkerUrls(page)).toEqual([]);
  }
  expect(analysisRequests).toEqual([]);
});
