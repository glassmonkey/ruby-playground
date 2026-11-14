import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import {
  editRuby,
  expectEditorSource,
  expectRubyExecutionStatus,
  expectRubyOutput,
} from "./editor";
import { buildShareUrl } from "../src/share";
import {
  analysisWorkerTerminations,
  analysisWorkerUrls,
  heldCompletionResponses,
  latestRawCompletion,
  lspObservations,
  releaseHeldCompletionResponse,
  watchAnalysisWorkers,
} from "./completion-lsp-observer";

function verifyGeneratedWasm(
  manifestEntry: unknown,
  wasmBytes: Buffer,
): string {
  if (!manifestEntry || typeof manifestEntry !== "object") {
    throw new Error("Generated LSP manifest has no analysis WASM entry");
  }
  const entry = manifestEntry as { bytes?: unknown; sha256?: unknown };
  const actualSha256 = createHash("sha256").update(wasmBytes).digest("hex");
  if (entry.bytes !== wasmBytes.byteLength) {
    throw new Error(
      `Generated analysis WASM byte count mismatch: manifest=${String(entry.bytes)}, actual=${wasmBytes.byteLength}`,
    );
  }
  if (entry.sha256 !== actualSha256) {
    throw new Error(
      `Generated analysis WASM SHA-256 mismatch: manifest=${String(entry.sha256)}, actual=${actualSha256}`,
    );
  }
  return actualSha256;
}

async function readGeneratedAnalysisAsset() {
  const manifestBytes = await readFile(
    new URL("../public/lsp/manifest.json", import.meta.url),
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    files?: Record<string, unknown>;
  };
  const wasmBytes = gunzipSync(
    await readFile(
      new URL("../public/lsp/typeprof-analysis.wasm.gz", import.meta.url),
    ),
  );
  const manifestEntry = manifest.files?.["typeprof-analysis.wasm"];
  const wasmSha256 = verifyGeneratedWasm(manifestEntry, wasmBytes);
  return {
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    manifestEntry,
    wasmBytes,
    wasmSha256,
  };
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
  await expectEditorSource(page, 'puts "hello".upcase');
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
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
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
  await mkdir(testInfo.outputPath(), { recursive: true });
  await watchAnalysisWorkers(page);
  const diagnostic: Record<string, unknown> = {
    uiHead:
      process.env.COMPLETION_UI_HEAD ??
      process.env.GITHUB_SHA ??
      "not-recorded",
    runtimeHead: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
    testSourceSha256:
      process.env.COMPLETION_TEST_SOURCE_SHA256 ?? "not-provided",
    observerSourceSha256:
      process.env.COMPLETION_OBSERVER_SOURCE_SHA256 ?? "not-provided",
    startedAt: Date.now(),
    startedMonotonicMs: await page.evaluate(() => performance.now()),
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    milestones: [] as Array<Record<string, unknown>>,
  };
  page.on("pageerror", (error) => {
    (diagnostic.pageErrors as string[]).push(error.stack ?? error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      (diagnostic.consoleErrors as string[]).push(message.text());
  });

  try {
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
    diagnostic.milestones = [
      ...(diagnostic.milestones as Array<Record<string, unknown>>),
      {
        name: "midline-suffix-query-entered",
        at: Date.now(),
        monotonicMs: await page.evaluate(() => performance.now()),
        source: await page.locator(".monaco-editor .view-lines").innerText(),
        lspObservations: await lspObservations(page),
      },
    ];
    await expect(page.locator(".monaco-editor .view-line")).toHaveText(
      'puts "hello".upc + "!"',
    );
    await page.screenshot({
      path: testInfo.outputPath("midline-prefix-input.png"),
    });
    const upcase = page
      .getByRole("listbox", { name: "Suggest" })
      .getByRole("listitem", { name: "upcase, Method", exact: true });
    await expect(upcase).toBeVisible({ timeout: 30_000 });
    await upcase.click();
    await expect(page.locator(".monaco-editor .view-line")).toHaveText(
      'puts "hello".upcase + "!"',
    );
    await expectRubyOutput(page, "HELLO!\n");
    await page.screenshot({
      path: testInfo.outputPath("midline-suffix-preserved.png"),
    });
    diagnostic.passed = true;
  } catch (error) {
    diagnostic.failure = error instanceof Error ? error.message : String(error);
    diagnostic.failureStack = error instanceof Error ? error.stack : undefined;
    throw error;
  } finally {
    diagnostic.finishedAt = Date.now();
    diagnostic.finishedMonotonicMs = await page
      .evaluate(() => performance.now())
      .catch((error) => String(error));
    diagnostic.finalSource = await page
      .locator(".monaco-editor .view-lines")
      .innerText()
      .catch((error) => String(error));
    diagnostic.caret = await page
      .evaluate(() => {
        const textarea = document.querySelector(
          ".monaco-editor textarea.inputarea",
        ) as HTMLTextAreaElement | null;
        const cursor = document.querySelector(
          ".monaco-editor .cursors-layer .cursor",
        );
        const cursorBounds = cursor?.getBoundingClientRect();
        const selection = window.getSelection();
        return {
          activeElement: document.activeElement?.outerHTML.slice(0, 300),
          textareaSelectionStart: textarea?.selectionStart,
          textareaSelectionEnd: textarea?.selectionEnd,
          domSelection: selection
            ? {
                anchorOffset: selection.anchorOffset,
                focusOffset: selection.focusOffset,
              }
            : undefined,
          cursorRect: cursorBounds
            ? {
                x: cursorBounds.x,
                y: cursorBounds.y,
                width: cursorBounds.width,
                height: cursorBounds.height,
              }
            : undefined,
        };
      })
      .catch((error) => String(error));
    diagnostic.workerUrls = await analysisWorkerUrls(page).catch((error) =>
      String(error),
    );
    diagnostic.terminationEvents = await analysisWorkerTerminations(page).catch(
      (error) => String(error),
    );
    diagnostic.lspObservations = await lspObservations(page).catch((error) =>
      String(error),
    );
    const observedEvents = diagnostic.lspObservations as
      Array<Record<string, unknown>> | undefined;
    if (observedEvents) {
      const responses = new Set(
        observedEvents
          .filter((event) => event.direction === "response")
          .map((event) => `${event.workerId}:${event.token}:${event.method}`),
      );
      diagnostic.unansweredRequests = observedEvents.filter(
        (event) =>
          event.direction === "request" &&
          !responses.has(`${event.workerId}:${event.token}:${event.method}`),
      );
    }
    diagnostic.finalDom = await page
      .evaluate(() => ({
        status: document.body.innerText.match(
          /\b(On|Off|Loading|Unavailable)\b/g,
        ),
        suggestions: [...document.querySelectorAll(".suggest-widget")].map(
          (element) => ({
            text: element.textContent,
            visible: element.getBoundingClientRect().width > 0,
            aria: element.getAttribute("aria-label"),
          }),
        ),
      }))
      .catch((error) => String(error));
    await page
      .screenshot({ path: testInfo.outputPath("midline-diagnostic-final.png") })
      .catch((error) => {
        diagnostic.screenshotFailure = String(error);
      });
    const serializedDiagnostic = JSON.stringify(diagnostic, null, 2);
    await writeFile(
      testInfo.outputPath("midline-diagnostic.json"),
      serializedDiagnostic,
      "utf8",
    );
    await testInfo.attach("midline-diagnostic.json", {
      body: serializedDiagnostic,
      contentType: "application/json",
    });
  }
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
  await page.screenshot({
    path: testInfo.outputPath("emoji-utf16-inserted.png"),
  });

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
  await page.screenshot({
    path: testInfo.outputPath("japanese-variable-inserted.png"),
  });
});

test("Mine#rfind and Array#rfind remain distinct after declaration removal", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("./?v=4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await editRuby(
    page,
    'class Mine; def rfind; "custom"; end; end\nputs Mine.new.r',
  );
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
  await page.screenshot({
    path: testInfo.outputPath("mine-rfind-inserted.png"),
  });

  await editRuby(page, "puts [1,2].");
  await page.keyboard.type("rf");
  const arrayMethod = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: "rfind, Method", exact: true });
  await expect(arrayMethod).toBeVisible({ timeout: 30_000 });
  await arrayMethod.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    "puts [1,2].rfind",
  );
  await page.screenshot({
    path: testInfo.outputPath("array-rfind-after-deletion.png"),
  });
});

test("Ruby API completions track 3.3 to 4.0 to 3.3 and expose raw item metadata", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
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
    (event) =>
      event.direction === "response" &&
      event.method === "textDocument/completion",
  ).length;
  await editRuby(page, "Ractor.");
  await page.keyboard.type("yi");
  await expect(yieldItem).toBeVisible({ timeout: 30_000 });
  let rawItems = latestRawCompletion(await lspObservations(page));
  expect(rawItems.some((item) => item.label === "yield" && item.textEdit)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("ruby-3.3-ractor-yield.png"),
  });
  await yieldItem.click();
  await expect(page.locator(".monaco-editor .view-line")).toHaveText(
    "Ractor.yield",
  );

  responseCount = (await lspObservations(page)).filter(
    (event) =>
      event.direction === "response" &&
      event.method === "textDocument/completion",
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
  await page.screenshot({
    path: testInfo.outputPath("ruby-3.3-rfind-absent.png"),
  });

  await page.getByLabel("Ruby version").selectOption("4.0");
  await expect(page.getByLabel("Ruby version")).toHaveValue("4.0");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  responseCount = (await lspObservations(page)).filter(
    (event) =>
      event.direction === "response" &&
      event.method === "textDocument/completion",
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
  await page.screenshot({
    path: testInfo.outputPath("ruby-4.0-ractor-yield-absent.png"),
  });

  responseCount = (await lspObservations(page)).filter(
    (event) =>
      event.direction === "response" &&
      event.method === "textDocument/completion",
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
  await page.screenshot({
    path: testInfo.outputPath("ruby-4.0-fiber-raise.png"),
  });

  await page.getByLabel("Ruby version").selectOption("3.3");
  await expect(page.getByLabel("Ruby version")).toHaveValue("3.3");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  responseCount = (await lspObservations(page)).filter(
    (event) =>
      event.direction === "response" &&
      event.method === "textDocument/completion",
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
  await page.screenshot({
    path: testInfo.outputPath("ruby-3.3-rfind-restored-absent.png"),
  });

  await editRuby(page, "puts Fiber.new.");
  await page.keyboard.type("rai");
  await expect(raiseItem).toBeVisible({ timeout: 30_000 });
  rawItems = latestRawCompletion(await lspObservations(page));
  const rawRaise33 = rawItems.find((item) => item.label === "raise");
  expect(rawRaise33?.textEdit).toBeDefined();
  await page.screenshot({
    path: testInfo.outputPath("ruby-3.3-fiber-raise.png"),
  });

  const observations = await lspObservations(page);
  const protocolMethods = observations
    .filter((event) => event.direction === "request")
    .map((event) => event.method);
  const protocol = {
    observations,
    signatures: {
      ruby33FiberRaiseDetail: rawRaise33?.detail,
      ruby40FiberRaiseDetail: rawRaise40?.detail,
    },
    protocolMethods,
  };
  const serializedProtocol = JSON.stringify(protocol, null, 2);
  await writeFile(
    testInfo.outputPath("lsp-protocol.json"),
    serializedProtocol,
    "utf8",
  );
  await testInfo.attach("lsp-protocol.json", {
    body: serializedProtocol,
    contentType: "application/json",
  });
});

test("Fiber#raise details follow the selected TypeProf Ruby core", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await mkdir(testInfo.outputPath(), { recursive: true });
  const generatedAnalysisAsset = await readGeneratedAnalysisAsset();
  const alternateWasm = Buffer.from("alternate valid WASM identity fixture");
  const alternateWasmSha256 = createHash("sha256")
    .update(alternateWasm)
    .digest("hex");
  expect(
    verifyGeneratedWasm(
      { bytes: alternateWasm.byteLength, sha256: alternateWasmSha256 },
      alternateWasm,
    ),
  ).toBe(alternateWasmSha256);
  expect(() =>
    verifyGeneratedWasm(
      {
        bytes: alternateWasm.byteLength,
        sha256: generatedAnalysisAsset.wasmSha256,
      },
      alternateWasm,
    ),
  ).toThrow(/analysis WASM SHA-256 mismatch/);

  await watchAnalysisWorkers(page);
  await page.goto("./?v=3.3");
  const matrix: Array<Record<string, unknown>> = [];
  let previousWorkerId: number | undefined;

  try {
    for (const [index, version] of ["3.3", "4.0", "3.3"].entries()) {
      const record: Record<string, unknown> = {
        index,
        version,
        startedAt: Date.now(),
        manifestSha256: generatedAnalysisAsset.manifestSha256,
        manifestWasmSha256: generatedAnalysisAsset.wasmSha256,
      };
      matrix.push(record);
      try {
        const before = await lspObservations(page);
        const readyCountBefore = before.filter(
          (event) => event.direction === "ready",
        ).length;
        const needsNewWorker =
          new URL(page.url()).searchParams.get("v") !== version;
        const canReuseInitialReady =
          !needsNewWorker && previousWorkerId === undefined;
        record.readyCountBefore = readyCountBefore;
        record.canReuseInitialReady = canReuseInitialReady;
        if (needsNewWorker) {
          await page.getByLabel("Ruby version").selectOption(version);
        }
        await expect(page.getByLabel("Ruby version")).toHaveValue(version);
        await expect(page.getByText("On", { exact: true })).toBeVisible({
          timeout: 60_000,
        });
        const patchVersion = version === "3.3" ? "3.3.3" : "4.0.0";
        await expect(
          page
            .getByRole("region", { name: "Ruby runtime environment" })
            .getByRole("heading", {
              name: `Ruby ${patchVersion}`,
              exact: true,
            }),
        ).toBeVisible();
        await expect
          .poll(
            async () => {
              const readyEvents = (await lspObservations(page)).filter(
                (event) => event.direction === "ready",
              );
              const eligible = canReuseInitialReady
                ? readyEvents
                : readyEvents.slice(readyCountBefore);
              return eligible.some(
                (event) =>
                  event.version === version &&
                  (canReuseInitialReady || event.workerId !== previousWorkerId),
              );
            },
            { timeout: 60_000 },
          )
          .toBe(true);

        const observationsBeforeInput = await lspObservations(page);
        const readyEvents = observationsBeforeInput.filter(
          (event) => event.direction === "ready",
        );
        const eligibleReadyEvents = canReuseInitialReady
          ? readyEvents
          : readyEvents.slice(readyCountBefore);
        const ready = eligibleReadyEvents.find(
          (event) =>
            event.version === version &&
            (canReuseInitialReady || event.workerId !== previousWorkerId),
        );
        expect(ready).toBeDefined();
        const workerId = ready?.workerId;
        expect(ready?.wasmSha256).toBe(generatedAnalysisAsset.wasmSha256);
        record.ready = ready;
        record.workerId = workerId;
        record.readyGeneration =
          observationsBeforeInput
            .filter((event) => event.direction === "ready")
            .findIndex((event) => event.workerId === workerId) + 1;

        await editRuby(page, "puts Fiber.new {}.");
        const responseStart = (await lspObservations(page)).length;
        record.inputStartedAt = await page.evaluate(() => performance.now());
        await page.keyboard.type("rai", { delay: 100 });
        await expectEditorSource(page, "puts Fiber.new {}.rai");
        await expect
          .poll(
            async () =>
              (await lspObservations(page))
                .slice(responseStart)
                .some(
                  (event) =>
                    event.direction === "response" &&
                    event.method === "textDocument/completion" &&
                    event.workerId === workerId &&
                    (
                      event.candidates as Array<{ label?: string }> | undefined
                    )?.some((candidate) => candidate.label === "raise"),
                ),
            { timeout: 30_000 },
          )
          .toBe(true);
        const completionResponse = (await lspObservations(page))
          .slice(responseStart)
          .filter(
            (event) =>
              event.direction === "response" &&
              event.method === "textDocument/completion" &&
              event.workerId === workerId &&
              (event.candidates as Array<{ label?: string }> | undefined)?.some(
                (candidate) => candidate.label === "raise",
              ),
          )
          .at(-1);
        const raise = (
          (completionResponse?.candidates as Array<{
            label?: string;
            detail?: string;
            documentation?: string;
            data?: unknown;
            textEdit?: unknown;
          }>) ?? []
        ).find((candidate) => candidate.label === "raise");
        expect(completionResponse).toBeDefined();
        expect(raise).toBeDefined();
        const rawDetails = `${raise?.detail ?? ""}\n${raise?.documentation ?? ""}`;
        expect(rawDetails).toContain("raise");
        expect(rawDetails.includes("cause")).toBe(version === "4.0");
        record.completionResponse = completionResponse;
        record.rawRaise = raise;
        record.rawDetails = rawDetails;

        const raiseRow = page
          .getByRole("listbox", { name: "Suggest" })
          .getByRole("listitem", { name: /^raise(?:,|$)/ });
        await expect(raiseRow).toBeVisible();
        await raiseRow.hover();
        const detailsPanel = page.locator(".suggest-details");
        if (!(await detailsPanel.isVisible().catch(() => false))) {
          const readMore = raiseRow.locator(".codicon-suggest-more-info");
          await expect(readMore).toBeVisible();
          await readMore.click();
        }
        await expect(detailsPanel).toBeVisible();
        const renderedDetail = await detailsPanel.locator(".type").innerText();
        const renderedDocs = await detailsPanel.locator(".docs").innerText();
        const renderedDetails = `${renderedDetail}\n${renderedDocs}`;
        expect(renderedDetails).toContain("raise");
        expect(renderedDetails.includes("cause")).toBe(version === "4.0");
        record.renderedDetails = renderedDetails;
        record.renderedDom = await detailsPanel.evaluate((element) => ({
          text: element.textContent,
          visible: element.getBoundingClientRect().width > 0,
        }));
        record.finishedAt = Date.now();
        record.passed = true;
        await page.screenshot({
          path: testInfo.outputPath(`fiber-typeprof-${version}-${index}.png`),
        });
        previousWorkerId = workerId as number;
      } catch (error) {
        record.failure = error instanceof Error ? error.message : String(error);
        record.failureStack = error instanceof Error ? error.stack : undefined;
        throw error;
      } finally {
        record.finishedAt ??= Date.now();
        record.observations = await lspObservations(page)
          .then((events) =>
            events.filter((event) => event.workerId === record.workerId),
          )
          .catch((error) => String(error));
        record.finalDom = await page
          .evaluate(() => ({
            source: document.querySelector(".monaco-editor .view-lines")
              ?.textContent,
            details: [...document.querySelectorAll(".suggest-details")].map(
              (element) => ({
                text: element.textContent,
                visible: element.getBoundingClientRect().width > 0,
              }),
            ),
          }))
          .catch((error) => String(error));
        await page
          .screenshot({
            path: testInfo.outputPath(
              `fiber-typeprof-final-${version}-${index}.png`,
            ),
          })
          .catch((error) => {
            record.screenshotFailure = String(error);
          });
        await writeFile(
          testInfo.outputPath(`fiber-typeprof-${version}-${index}.json`),
          JSON.stringify(record, null, 2),
          "utf8",
        );
        await testInfo.attach(`fiber-typeprof-${version}-${index}.json`, {
          body: JSON.stringify(record, null, 2),
          contentType: "application/json",
        });
      }
    }
  } finally {
    const matrixRecord = {
      uiCommit: process.env.COMPLETION_UI_HEAD ?? "not-recorded",
      runtimeCommit: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
      manifestSha256: generatedAnalysisAsset.manifestSha256,
      wasmSha256: generatedAnalysisAsset.wasmSha256,
      matrix,
      observations: await lspObservations(page).catch((error) => String(error)),
    };
    const serialized = JSON.stringify(matrixRecord, null, 2);
    await writeFile(
      testInfo.outputPath("fiber-typeprof-version-matrix.json"),
      serialized,
      "utf8",
    );
    await testInfo.attach("fiber-typeprof-version-matrix.json", {
      body: serialized,
      contentType: "application/json",
    });
  }
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
  await page.screenshot({
    path: testInfo.outputPath("cold-upcase-inserted.png"),
  });

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
  await page.screenshot({
    path: testInfo.outputPath("warm-upcase-inserted.png"),
  });

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
  const generatedAnalysisAsset = await readGeneratedAnalysisAsset();
  expect(
    ready.every(
      (event) => event.wasmSha256 === generatedAnalysisAsset.wasmSha256,
    ),
  ).toBe(true);
  const metrics = {
    head:
      process.env.COMPLETION_UI_HEAD ??
      process.env.GITHUB_SHA ??
      "not-recorded",
    runtimeCommit: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
    version: "4.0",
    manifestSha256: generatedAnalysisAsset.manifestSha256,
    wasmSha256: generatedAnalysisAsset.wasmSha256,
    coldReadyMs,
    coldCandidateUiMs,
    warmCandidateUiMs,
    workerReady: ready,
    completionResponses: completions,
    httpAssets,
  };
  const serializedMetrics = JSON.stringify(metrics, null, 2);
  await writeFile(
    testInfo.outputPath("browser-metrics.json"),
    serializedMetrics,
    "utf8",
  );
  await testInfo.attach("browser-metrics.json", {
    body: serializedMetrics,
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
  await expect
    .poll(async () => (await analysisWorkerTerminations(page)).length)
    .toBe(1);
  await expectRubyOutput(page, "HELLO\n");
  await page.screenshot({
    path: testInfo.outputPath("off-disposed-worker.png"),
  });

  await completionToggle.click();
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(async () => (await analysisWorkerUrls(page)).length)
    .toBe(2);

  await page.getByLabel("Ruby version").selectOption("3.4");
  await expect(page.getByLabel("Ruby version")).toHaveValue("3.4");
  await expect(
    page.getByText("Unavailable for Ruby 3.4", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await analysisWorkerTerminations(page)).length)
    .toBe(2);
  expect(await analysisWorkerUrls(page)).toHaveLength(2);
  await expect(page.getByRole("listbox", { name: "Suggest" })).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("unsupported-disposed-worker.png"),
  });

  await page.getByLabel("Ruby version").selectOption("3.3");
  await expect(page.getByLabel("Ruby version")).toHaveValue("3.3");
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(async () => (await analysisWorkerUrls(page)).length)
    .toBe(3);
  await editRuby(page, 'puts "worker recreated"');
  await expectRubyOutput(page, "worker recreated\n");
  await page.screenshot({
    path: testInfo.outputPath("worker-recreated-3.3.png"),
  });

  const lifecycle = {
    workerUrls: await analysisWorkerUrls(page),
    terminations: await analysisWorkerTerminations(page),
    observations: await lspObservations(page),
  };
  const serializedLifecycle = JSON.stringify(lifecycle, null, 2);
  await writeFile(
    testInfo.outputPath("lifecycle.json"),
    serializedLifecycle,
    "utf8",
  );
  await testInfo.attach("lifecycle.json", {
    body: serializedLifecycle,
    contentType: "application/json",
  });
});

test("ignores a forced late completion response after OFF disposes its worker", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await mkdir(testInfo.outputPath(), { recursive: true });
  await watchAnalysisWorkers(page, { holdCompletionResponses: true });
  const record: Record<string, unknown> = {
    uiHead:
      process.env.COMPLETION_UI_HEAD ??
      process.env.GITHUB_SHA ??
      "not-recorded",
    runtimeHead: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
    testSourceSha256:
      process.env.COMPLETION_TEST_SOURCE_SHA256 ?? "not-provided",
    observerSourceSha256:
      process.env.COMPLETION_OBSERVER_SOURCE_SHA256 ?? "not-provided",
    startedAt: Date.now(),
  };

  try {
    await page.goto("./?v=4.0");
    await expect(page.getByText("On", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await editRuby(page, 'puts "hello"');
    await page.keyboard.type(".upc");
    await expect
      .poll(async () => (await heldCompletionResponses(page)).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    const held = await heldCompletionResponses(page);
    record.heldBeforeOff = held;
    record.requestsBeforeOff = await lspObservations(page);
    const delayedCompletion = held.find(
      (entry) => entry.method === "textDocument/completion",
    );
    expect(delayedCompletion).toBeDefined();
    record.delayedCompletion = delayedCompletion;

    await page.locator('label[for="completion-enabled"]').click();
    await expect(page.getByText("Off", { exact: true })).toBeVisible();
    await expect
      .poll(async () => analysisWorkerTerminations(page), { timeout: 10_000 })
      .toHaveLength(1);
    await expect(page.getByRole("listbox", { name: "Suggest" })).toBeHidden();
    record.terminatedBeforeLateDelivery = true;

    const released: Array<Record<string, unknown>> = [];
    for (const response of held) {
      const releaseSucceeded = await releaseHeldCompletionResponse(
        page,
        response.workerId,
        response.token,
      );
      released.push({
        workerId: response.workerId,
        token: response.token,
        releaseSucceeded,
      });
    }
    record.releasedAfterDispose = released;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    await expect(page.getByText("Off", { exact: true })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Suggest" })).toBeHidden();
    expect(await analysisWorkerTerminations(page)).toHaveLength(1);
    expect(await analysisWorkerUrls(page)).toHaveLength(1);
    record.observationsAfterLateDelivery = await lspObservations(page);
    record.finalSource = await page
      .locator(".monaco-editor .view-lines")
      .innerText();
    await editRuby(page, 'puts "OFF still permits Ruby execution"');
    await expectRubyOutput(page, "OFF still permits Ruby execution\n");
    record.executionAfterOff = "OFF still permits Ruby execution";
    record.passed = true;
  } catch (error) {
    record.failure = error instanceof Error ? error.message : String(error);
    record.failureStack = error instanceof Error ? error.stack : undefined;
    throw error;
  } finally {
    record.finishedAt = Date.now();
    record.finalObservations = await lspObservations(page).catch((error) =>
      String(error),
    );
    record.finalWorkerUrls = await analysisWorkerUrls(page).catch((error) =>
      String(error),
    );
    record.finalTerminations = await analysisWorkerTerminations(page).catch(
      (error) => String(error),
    );
    record.finalDom = await page
      .evaluate(() => ({
        completionStatus: document.body.innerText.match(
          /\b(On|Off|Loading|Unavailable)\b/g,
        ),
        suggestions: [...document.querySelectorAll(".suggest-widget")].map(
          (element) => ({
            text: element.textContent,
            visible: element.getBoundingClientRect().width > 0,
          }),
        ),
        source: document.querySelector(".monaco-editor .view-lines")
          ?.textContent,
      }))
      .catch((error) => String(error));
    await page
      .screenshot({
        path: testInfo.outputPath("late-completion-off-final.png"),
      })
      .catch((error) => {
        record.screenshotFailure = String(error);
      });
    await writeFile(
      testInfo.outputPath("late-completion-off.json"),
      JSON.stringify(record, null, 2),
      "utf8",
    );
    await testInfo.attach("late-completion-off.json", {
      body: JSON.stringify(record, null, 2),
      contentType: "application/json",
    });
  }
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
  await page.screenshot({
    path: testInfo.outputPath("no-matching-completion.png"),
  });
  await expectRubyExecutionStatus(page, "Error");
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
  await expect(
    page.getByRole("checkbox", { name: "Code completion" }),
  ).not.toBeChecked();
  await expectRubyOutput(page, "completion off\n");
  await page.screenshot({ path: testInfo.outputPath("completion-off.png") });
  expect(new URL(page.url()).searchParams.get("ac")).toBe("0");
  expect(await analysisWorkerUrls(page)).toEqual([]);
  expect(analysisAssetRequests).toEqual([]);

  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Code completion" }),
  ).not.toBeChecked();
  await expectRubyOutput(page, "completion off\n");
  expect(await analysisWorkerUrls(page)).toEqual([]);
  expect(analysisAssetRequests).toEqual([]);

  await page.goto(onURL);
  await expect(
    page.getByRole("checkbox", { name: "Code completion" }),
  ).toBeChecked();
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expectRubyOutput(page, "completion on\n");
  await page.screenshot({ path: testInfo.outputPath("completion-on.png") });
  expect(await analysisWorkerUrls(page)).toHaveLength(1);
  expect(analysisAssetRequests).toContain("/lsp/manifest.json");

  await page.goBack();
  await expect(
    page.getByRole("checkbox", { name: "Code completion" }),
  ).not.toBeChecked();
  await expectRubyOutput(page, "completion off\n");
  expect(new URL(page.url()).searchParams.get("ac")).toBe("0");
  expect(await analysisWorkerUrls(page)).toEqual([]);

  await page.goForward();
  await expect(
    page.getByRole("checkbox", { name: "Code completion" }),
  ).toBeChecked();
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
