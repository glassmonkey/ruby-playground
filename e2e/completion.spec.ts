import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import {
  codeOnlyUrl,
  editRuby,
  expectEditorSource,
  expectRubyExecutionStatus,
  expectRubyOutput,
} from "./editor";
import { buildShareUrl } from "../src/share";
import { captureE2eSourceProvenance } from "./provenance";
import {
  analysisWorkerTerminations,
  analysisWorkerUrls,
  completionResponseForSnapshot,
  expectHeldClientDeliveryProof,
  heldCompletionResponses,
  isSuccessfulCompletionResponse,
  lspObservations,
  normalizeCompletionSource,
  releaseHeldCompletionResponse,
  watchAnalysisWorkers,
} from "./completion-lsp-observer";

function visibleCandidateLabel(page: Page, label: string) {
  return page
    .getByRole("listbox", { name: "Suggest" })
    .locator(".monaco-list-row .label-name")
    .getByText(label, { exact: true });
}

function candidateRow(page: Page, label: string) {
  return visibleCandidateLabel(page, label).locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' monaco-list-row ')][1]",
  );
}

async function readyWorkerId(
  page: Page,
  version: string,
  previousWorkerId?: number,
) {
  let workerId: number | undefined;
  await expect
    .poll(async () => {
      const ready = (await lspObservations(page))
        .filter(
          (event) => event.direction === "ready" && event.version === version,
        )
        .at(-1);
      workerId = ready?.workerId as number | undefined;
      return (
        workerId !== undefined &&
        (previousWorkerId === undefined || workerId > previousWorkerId)
      );
    })
    .toBe(true);
  return workerId as number;
}

async function waitForCompletionSnapshot(
  page: Page,
  options: {
    workerId: number;
    source: string;
    position: { line: number; character: number };
  },
) {
  let snapshot: ReturnType<typeof completionResponseForSnapshot>;
  await expect
    .poll(
      async () => {
        snapshot = completionResponseForSnapshot(
          await lspObservations(page),
          options,
        );
        return Boolean(snapshot);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(snapshot).toBeDefined();
  expect(isSuccessfulCompletionResponse(snapshot!.response)).toBe(true);
  return snapshot!;
}

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
  await page.goto(codeOnlyUrl("", "4.0"));
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
  await page.goto(codeOnlyUrl());
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

test("core asset failure preserves execution and recovers after OFF then ON", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const corePattern = /\/lsp\/versioned\/core-4\.0\.json\.gz(?:\?.*)?$/;
  let coreFailureUrl: string | undefined;
  let manifestStatus: number | undefined;
  let coreAbortCount = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) =>
    pageErrors.push(error.stack ?? error.message),
  );
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/lsp/manifest.json"))
      manifestStatus = response.status();
  });
  await watchAnalysisWorkers(page);
  await page.route(corePattern, async (route) => {
    coreAbortCount += 1;
    coreFailureUrl = route.request().url();
    await route.abort("failed");
  });

  const diagnostic: Record<string, unknown> = {
    uiHead: process.env.COMPLETION_UI_HEAD ?? "not-provided",
    runtimeCommit: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-provided",
    startedAt: Date.now(),
    pageErrors,
  };
  try {
    await page.goto(codeOnlyUrl("", "4.0"));
    const completionStatus = page.getByRole("status", {
      name: /^Code completion status:/,
    });
    await expect(completionStatus).toHaveText("Unavailable", {
      timeout: 60_000,
    });
    expect(manifestStatus).toBe(200);
    expect(coreAbortCount).toBe(1);
    expect(coreFailureUrl).toContain("sha256=");
    diagnostic.manifestStatus = manifestStatus;
    diagnostic.coreFailureUrl = coreFailureUrl;

    await editRuby(page, 'puts "execution survives core download failure"');
    await expectRubyOutput(page, "execution survives core download failure\n");

    await page.unroute(corePattern);
    const completionToggle = page.getByRole("checkbox", {
      name: "Code completion",
    });
    const completionSwitch = completionToggle.locator("xpath=..");
    await completionSwitch.click();
    await expect(completionToggle).not.toBeChecked();
    await expect(completionStatus).toHaveText("Off");
    await completionSwitch.click();
    await expect(completionToggle).toBeChecked();
    await expect(completionStatus).toHaveText("On", { timeout: 60_000 });

    await editRuby(page, 'puts "hello"');
    await page.keyboard.type(".upc", { delay: 50 });
    const upcase = page
      .getByRole("listbox", { name: "Suggest" })
      .locator(".monaco-list-row .label-name")
      .getByText("upcase", { exact: true });
    await expect(upcase).toBeVisible({ timeout: 30_000 });
    await upcase.click();
    await expectEditorSource(page, 'puts "hello".upcase');
    await expectRubyOutput(page, "HELLO\n");
    diagnostic.result = "passed";
  } catch (error) {
    diagnostic.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    diagnostic.finishedAt = Date.now();
    diagnostic.pageErrors = pageErrors;
    diagnostic.observations = await lspObservations(page).catch((error) =>
      String(error),
    );
    diagnostic.finalSource = await page
      .locator(".monaco-editor .view-lines")
      .innerText()
      .catch((error) => String(error));
    diagnostic.finalOutput = await page
      .getByTestId("preview-console")
      .innerText()
      .catch((error) => String(error));
    const path = testInfo.outputPath("core-download-recovery.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(diagnostic, null, 2), "utf8");
    await testInfo.attach("core-download-recovery.json", {
      path,
      contentType: "application/json",
    });
    await page
      .screenshot({
        path: testInfo.outputPath("core-download-recovery-final.png"),
      })
      .catch(() => undefined);
  }
});

test("code-only history navigation preserves ready completion and natural suggestions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await watchAnalysisWorkers(page);
  await page.goto(codeOnlyUrl("", "4.0"));
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
  const provenance = await captureE2eSourceProvenance(testInfo);
  await mkdir(testInfo.outputPath(), { recursive: true });
  await watchAnalysisWorkers(page);
  const diagnostic: Record<string, unknown> = {
    actualGitHead: provenance.actualGitHead,
    runtimeHead: process.env.COMPLETION_RUNTIME_COMMIT ?? null,
    testSourceSha256: provenance.testSourceSha256,
    observerSourceSha256: provenance.observerSourceSha256,
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
    await page.goto(codeOnlyUrl("", "4.0"));
    await expect(page.getByText("On", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const workerId = await readyWorkerId(page, "4.0");

    const completionStart = (await lspObservations(page)).length;
    await editRuby(page, 'pu "Ruby"');
    for (let index = 0; index < 7; index += 1)
      await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("t");
    await expectEditorSource(page, 'put "Ruby"');
    let putsResponse: Record<string, unknown> | undefined;
    await expect
      .poll(async () => {
        const events = await lspObservations(page);
        const snapshot = completionResponseForSnapshot(
          events.slice(completionStart),
          {
            workerId,
            source: 'put "Ruby"',
            position: { line: 0, character: 3 },
          },
        );
        if (!snapshot || !isSuccessfulCompletionResponse(snapshot.response))
          return false;
        putsResponse = snapshot.response;
        return Boolean(
          (
            putsResponse.candidates as Array<{ label?: string }> | undefined
          )?.some((candidate) => candidate.label === "puts"),
        );
      })
      .toBe(true);
    expect(putsResponse?.position).toEqual({ line: 0, character: 3 });
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
  await page.goto(codeOnlyUrl("", "4.0"));
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
  const provenance = await captureE2eSourceProvenance(testInfo);
  const diagnostic: Record<string, unknown> = {
    actualGitHead: provenance.actualGitHead,
    testSourceSha256: provenance.testSourceSha256,
    observerSourceSha256: provenance.observerSourceSha256,
    phases: [] as string[],
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
  };
  page.on("pageerror", (error) =>
    (diagnostic.pageErrors as string[]).push(error.stack ?? error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      (diagnostic.consoleErrors as string[]).push(message.text());
  });
  await watchAnalysisWorkers(page);
  try {
    (diagnostic.phases as string[]).push("load Ruby 4.0 editor");
    await page.goto(codeOnlyUrl("", "4.0"));
    await expect(page.getByText("On", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const workerId = await readyWorkerId(page, "4.0");

    const customSource =
      'class Mine; def rfind; "custom"; end; end\nputs Mine.new.rf';
    await editRuby(
      page,
      'class Mine; def rfind; "custom"; end; end\nputs Mine.new.r',
    );
    (diagnostic.phases as string[]).push("custom Mine method candidate");
    await page.keyboard.type("f");
    await expectEditorSource(page, customSource);
    const customResponse = await waitForCompletionSnapshot(page, {
      workerId,
      source: customSource,
      position: { line: 1, character: 16 },
    });
    expect(
      (customResponse.response.candidates as Array<{ label?: string }>).some(
        (candidate) => candidate.label === "rfind",
      ),
    ).toBe(true);
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

    (diagnostic.phases as string[]).push(
      "same Mine receiver after declaration removal",
    );
    await editRuby(page, "class Mine; end\nputs Mine.new.r");
    await page.keyboard.type("f");
    await expectEditorSource(page, "class Mine; end\nputs Mine.new.rf");
    const removedResponse = await waitForCompletionSnapshot(page, {
      workerId,
      source: "class Mine; end\nputs Mine.new.rf",
      position: { line: 1, character: 16 },
    });
    expect(
      (removedResponse.response.candidates as Array<{ label?: string }>).some(
        (candidate) => candidate.label === "rfind",
      ),
    ).toBe(false);
    await expect(visibleCandidateLabel(page, "rfind")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("mine-rfind-removed-from-same-receiver.png"),
    });

    (diagnostic.phases as string[]).push("Array rfind remains available");
    await editRuby(page, "puts [1,2]");
    await page.keyboard.type(".");
    await expectEditorSource(page, "puts [1,2].");
    const arrayDotResponse = await waitForCompletionSnapshot(page, {
      workerId,
      source: "puts [1,2].",
      position: { line: 0, character: 11 },
    });
    expect(
      (arrayDotResponse.response.candidates as Array<{ label?: string }>).some(
        (candidate) => candidate.label === "rfind",
      ),
    ).toBe(true);
    await page.keyboard.type("rf");
    await expectEditorSource(page, "puts [1,2].rf");
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
  } finally {
    diagnostic.lspObservations = await lspObservations(page).catch((error) => [
      { readError: String(error) },
    ]);
    diagnostic.finalEditorLines = await page
      .locator(".monaco-editor .view-line")
      .allTextContents()
      .catch((error) => [`read error: ${String(error)}`]);
    const serialized = JSON.stringify(diagnostic, null, 2);
    await writeFile(
      testInfo.outputPath("mine-array-diagnostic.json"),
      serialized,
      "utf8",
    );
    await testInfo.attach("mine-array-diagnostic.json", {
      body: serialized,
      contentType: "application/json",
    });
  }
});

test("Ruby 3.3 keeps a custom Mine#rfind without adding Array#rfind", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const provenance = await captureE2eSourceProvenance(testInfo);
  const diagnostic: Record<string, unknown> = {
    actualGitHead: provenance.actualGitHead,
    testSourceSha256: provenance.testSourceSha256,
    observerSourceSha256: provenance.observerSourceSha256,
  };
  page.on("pageerror", (error) =>
    ((diagnostic.pageErrors ??= []) as string[]).push(
      error.stack ?? error.message,
    ),
  );
  await watchAnalysisWorkers(page);
  try {
    await page.goto(codeOnlyUrl("", "3.3"));
    await expect(page.getByText("On", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const workerId = await readyWorkerId(page, "3.3");
    const customSource =
      'class Mine; def rfind; "custom"; end; end\nputs Mine.new.rf';
    await editRuby(
      page,
      'class Mine; def rfind; "custom"; end; end\nputs Mine.new.r',
    );
    await page.keyboard.type("f");
    await expectEditorSource(page, customSource);
    const custom = await waitForCompletionSnapshot(page, {
      workerId,
      source: customSource,
      position: { line: 1, character: 16 },
    });
    const customCandidates = custom.response.candidates as Array<{
      label?: string;
    }>;
    expect(
      customCandidates.some((candidate) => candidate.label === "rfind"),
    ).toBe(true);
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

    const removedSource = "class Mine; end\nputs Mine.new.rf";
    await editRuby(page, "class Mine; end\nputs Mine.new.r");
    await page.keyboard.type("f");
    await expectEditorSource(page, removedSource);
    const removed = await waitForCompletionSnapshot(page, {
      workerId,
      source: removedSource,
      position: { line: 1, character: 16 },
    });
    expect(
      (removed.response.candidates as Array<{ label?: string }>).some(
        (candidate) => candidate.label === "rfind",
      ),
    ).toBe(false);

    await editRuby(page, "puts [1,2]");
    await page.keyboard.type(".");
    await expectEditorSource(page, "puts [1,2].");
    const array = await waitForCompletionSnapshot(page, {
      workerId,
      source: "puts [1,2].",
      position: { line: 0, character: 11 },
    });
    expect(
      (array.response.candidates as Array<{ label?: string }>).some(
        (candidate) => candidate.label === "rfind",
      ),
    ).toBe(false);
    await page.keyboard.type("rf");
    await expectEditorSource(page, "puts [1,2].rf");
    await expect(visibleCandidateLabel(page, "rfind")).toHaveCount(0);
  } finally {
    diagnostic.lspObservations = await lspObservations(page).catch((error) => [
      { readError: String(error) },
    ]);
    diagnostic.finalEditorLines = await page
      .locator(".monaco-editor .view-line")
      .allTextContents()
      .catch((error) => [`read error: ${String(error)}`]);
    const serialized = JSON.stringify(diagnostic, null, 2);
    await writeFile(
      testInfo.outputPath("mine-array-3-3-diagnostic.json"),
      serialized,
      "utf8",
    );
    await testInfo.attach("mine-array-3-3-diagnostic.json", {
      body: serialized,
      contentType: "application/json",
    });
  }
});

test("Ruby API completions track 3.3 to 4.0 to 3.3 and expose raw item metadata", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const provenance = await captureE2eSourceProvenance(testInfo);
  const startedAt = Date.now();
  let failure: string | undefined;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) =>
    pageErrors.push(error.stack ?? error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await watchAnalysisWorkers(page);
    await page.goto(codeOnlyUrl("", "3.3"));
    await expect(page.getByText("On", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    let workerId = await readyWorkerId(page, "3.3");

    const rfind = visibleCandidateLabel(page, "rfind");
    const yieldItem = visibleCandidateLabel(page, "yield");
    const raiseItem = visibleCandidateLabel(page, "raise");

    await editRuby(page, "Ractor.");
    let snapshot = await waitForCompletionSnapshot(page, {
      workerId,
      source: "Ractor.",
      position: { line: 0, character: 7 },
    });
    let rawItems = snapshot.response.candidates as Array<{
      label?: string;
      textEdit?: unknown;
      detail?: string;
    }>;
    const rawYield33 = rawItems.find((item) => item.label === "yield");
    expect(rawYield33?.textEdit).toBeDefined();
    await page.keyboard.type("yi");
    await expectEditorSource(page, "Ractor.yi");
    await expect(yieldItem).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ruby-3.3-ractor-yield.png"),
    });
    await yieldItem.click();
    await expectEditorSource(page, "Ractor.yield");

    await editRuby(page, "puts [1,2].");
    snapshot = await waitForCompletionSnapshot(page, {
      workerId,
      source: "puts [1,2].",
      position: { line: 0, character: 11 },
    });
    rawItems = snapshot.response.candidates as Array<{ label?: string }>;
    expect(rawItems.some((item) => item.label === "rfind")).toBe(false);
    await page.keyboard.type("rf");
    await expectEditorSource(page, "puts [1,2].rf");
    await expect(rfind).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("ruby-3.3-rfind-absent.png"),
    });

    await page.getByLabel("Ruby version").selectOption("4.0");
    await expect(page.getByLabel("Ruby version")).toHaveValue("4.0");
    await expect(page.getByText("On", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    workerId = await readyWorkerId(page, "4.0", workerId);

    await editRuby(page, "Ractor.");
    snapshot = await waitForCompletionSnapshot(page, {
      workerId,
      source: "Ractor.",
      position: { line: 0, character: 7 },
    });
    rawItems = snapshot.response.candidates as Array<{ label?: string }>;
    expect(rawItems.some((item) => item.label === "yield")).toBe(false);
    await page.keyboard.type("yi");
    await expectEditorSource(page, "Ractor.yi");
    await expect(yieldItem).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("ruby-4.0-ractor-yield-absent.png"),
    });

    await editRuby(page, "puts [1,2].");
    snapshot = await waitForCompletionSnapshot(page, {
      workerId,
      source: "puts [1,2].",
      position: { line: 0, character: 11 },
    });
    rawItems = snapshot.response.candidates as Array<{
      label?: string;
      textEdit?: unknown;
      detail?: string;
    }>;
    const rawRfind = rawItems.find((item) => item.label === "rfind");
    expect(rawRfind?.textEdit).toBeDefined();
    await page.keyboard.type("rf");
    await expectEditorSource(page, "puts [1,2].rf");
    await expect(rfind).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath("ruby-4.0-rfind.png") });
    await rfind.click();
    await expectEditorSource(page, "puts [1,2].rfind");

    await editRuby(page, "puts Fiber.new.");
    snapshot = await waitForCompletionSnapshot(page, {
      workerId,
      source: "puts Fiber.new.",
      position: { line: 0, character: 15 },
    });
    await expect(raiseItem).toBeVisible({ timeout: 30_000 });
    rawItems = snapshot.response.candidates as Array<{
      label?: string;
      textEdit?: unknown;
      detail?: string;
    }>;
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
    workerId = await readyWorkerId(page, "3.3", workerId);

    await editRuby(page, "Ractor.");
    snapshot = await waitForCompletionSnapshot(page, {
      workerId,
      source: "Ractor.",
      position: { line: 0, character: 7 },
    });
    rawItems = snapshot.response.candidates as Array<{
      label?: string;
      textEdit?: unknown;
    }>;
    const rawYield33Restored = rawItems.find((item) => item.label === "yield");
    expect(rawYield33Restored?.textEdit).toBeDefined();
    await page.keyboard.type("yi");
    await expectEditorSource(page, "Ractor.yi");
    await expect(yieldItem).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ruby-3.3-restored-ractor-yield.png"),
    });
    await yieldItem.click();
    await expectEditorSource(page, "Ractor.yield");

    await editRuby(page, "puts [1,2].");
    snapshot = await waitForCompletionSnapshot(page, {
      workerId,
      source: "puts [1,2].",
      position: { line: 0, character: 11 },
    });
    rawItems = snapshot.response.candidates as Array<{ label?: string }>;
    expect(rawItems.some((item) => item.label === "rfind")).toBe(false);
    await page.keyboard.type("rf");
    await expectEditorSource(page, "puts [1,2].rf");
    await expect(rfind).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("ruby-3.3-rfind-restored-absent.png"),
    });

    await editRuby(page, "puts Fiber.new.");
    snapshot = await waitForCompletionSnapshot(page, {
      workerId,
      source: "puts Fiber.new.",
      position: { line: 0, character: 15 },
    });
    await expect(raiseItem).toBeVisible({ timeout: 30_000 });
    rawItems = snapshot.response.candidates as Array<{
      label?: string;
      textEdit?: unknown;
      detail?: string;
    }>;
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
      pageErrors,
      consoleErrors,
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
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } catch (error) {
    failure =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw error;
  } finally {
    const diagnosticPath = testInfo.outputPath(
      "ruby-api-version-diagnostic.json",
    );
    const diagnostic = {
      actualGitHead: provenance.actualGitHead,
      runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? null,
      testSourceSha256: provenance.testSourceSha256,
      observerSourceSha256: provenance.observerSourceSha256,
      startedAt,
      finishedAt: Date.now(),
      failure,
      pageErrors,
      consoleErrors,
      observations: await lspObservations(page).catch((error) => String(error)),
      finalUI: await page
        .evaluate(() => ({
          source: [...document.querySelectorAll(".monaco-editor .view-line")]
            .map((line) => line.textContent ?? "")
            .join("\n"),
          suggestions: [
            ...document.querySelectorAll('[role="listbox"] .monaco-list-row'),
          ].map((row) => row.textContent),
          completionStatus: document.querySelector(
            '[role="status"][aria-label^="Code completion status:"]',
          )?.textContent,
          detailText: [...document.querySelectorAll(".suggest-details")].map(
            (element) => element.textContent,
          ),
        }))
        .catch((error) => String(error)),
    };
    const serialized = JSON.stringify(diagnostic, null, 2);
    await mkdir(dirname(diagnosticPath), { recursive: true });
    await writeFile(diagnosticPath, serialized, "utf8");
    await testInfo
      .attach("ruby-api-version-diagnostic.json", {
        path: diagnosticPath,
        contentType: "application/json",
      })
      .catch(() => undefined);
  }
});

test("Fiber#raise details follow the selected TypeProf Ruby core", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
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
  await page.goto(codeOnlyUrl("", "3.3"));
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

        await editRuby(page, "puts Fiber.new.");
        const responseStart = (await lspObservations(page)).length;
        record.inputStartedAt = await page.evaluate(() => performance.now());
        await page.keyboard.type("rai", { delay: 100 });
        await expectEditorSource(page, "puts Fiber.new.rai");
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

        const raiseRow = candidateRow(page, "raise");
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
  const provenance = await captureE2eSourceProvenance(testInfo);
  await watchAnalysisWorkers(page);
  const measurements: Record<string, unknown>[] = [];
  let assetPhase = "before-navigation";
  const httpAssetResponses: Promise<Record<string, unknown>>[] = [];
  page.context().on("requestfinished", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/lsp/")) return;
    const requestPhase = assetPhase;
    httpAssetResponses.push(
      (async () => {
        const response = await request.response();
        const headers = response ? await response.allHeaders() : {};
        const sizes = await request.sizes();
        return {
          phase: requestPhase,
          path: url.pathname,
          status: response?.status(),
          fromServiceWorker: response?.fromServiceWorker(),
          contentLength: headers["content-length"],
          contentEncoding: headers["content-encoding"],
          responseBodyBytes: sizes.responseBodySize,
          responseBodyBytesQuality:
            sizes.responseBodySize < 0 ? "invalid-negative" : "observed",
          responseHeadersBytes: sizes.responseHeadersSize,
        };
      })().catch((error: unknown) => ({
        phase: requestPhase,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      })),
    );
  });
  const generatedAnalysisAsset = await readGeneratedAnalysisAsset();
  const metrics: Record<string, unknown> = {
    actualGitHead: provenance.actualGitHead,
    testSourceSha256: provenance.testSourceSha256,
    observerSourceSha256: provenance.observerSourceSha256,
    provenanceSourceSha256: provenance.provenanceSourceSha256,
    runtimeCommit: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
    manifestSha256: generatedAnalysisAsset.manifestSha256,
    wasmSha256: generatedAnalysisAsset.wasmSha256,
    cacheStateDefinition:
      "For 3.3, first Worker follows the Playwright test's fresh browser context. For 4.0 the page cache may be warm from 3.3. Each version's warm Worker is a distinct OFF-to-ON Worker in the same page with HTTP cache retained.",
    responseSizeNote:
      "Raw request.sizes() values are preserved. Negative responseBodyBytes are invalid observations and are not summed as transfer bytes.",
    measurements,
  };
  let activeMeasurement: Record<string, unknown> | undefined;
  try {
    for (const version of ["3.3", "4.0"] as const) {
      const versionAssetStartIndex = httpAssetResponses.length;
      activeMeasurement = { version, phase: "navigation" };
      measurements.push(activeMeasurement);
      assetPhase = `${version}-first-worker-assets`;
      const navigationStartedAt = performance.now();
      await page.goto(codeOnlyUrl("", version));
      await expect(page.getByText("On", { exact: true })).toBeVisible({
        timeout: 60_000,
      });
      const firstWorkerReadyMs = performance.now() - navigationStartedAt;
      activeMeasurement.firstWorkerReadyMs = firstWorkerReadyMs;
      const coldWorkerId = await readyWorkerId(page, version);
      activeMeasurement.coldWorkerId = coldWorkerId;
      const coldReady = (await lspObservations(page))
        .filter(
          (event) =>
            event.direction === "ready" && event.workerId === coldWorkerId,
        )
        .at(-1);
      expect(coldReady?.wasmSha256).toBe(generatedAnalysisAsset.wasmSha256);
      activeMeasurement.coldReady = coldReady;
      activeMeasurement.phase = "first-worker-ready";

      await editRuby(page, `puts "cold-${version}"`);
      const coldQueryStartedAt = performance.now();
      await page.keyboard.type(".upc");
      const coldCandidate = page
        .getByRole("listbox", { name: "Suggest" })
        .getByRole("listitem", { name: "upcase, Method", exact: true });
      await expect(coldCandidate).toBeVisible({ timeout: 30_000 });
      const coldCandidateUiMs = performance.now() - coldQueryStartedAt;
      activeMeasurement.coldCandidateUiMs = coldCandidateUiMs;
      await coldCandidate.click();
      await expect(page.locator(".monaco-editor .view-line")).toHaveText(
        `puts "cold-${version}".upcase`,
      );
      await expectRubyOutput(page, `COLD-${version}\n`);
      await page.screenshot({
        path: testInfo.outputPath(`cold-upcase-${version}.png`),
      });

      const completionToggle = page.getByRole("checkbox", {
        name: "Code completion",
      });
      const completionSwitch = completionToggle.locator("xpath=..");
      await completionSwitch.click();
      await expect(page.getByText("Off", { exact: true })).toBeVisible();
      activeMeasurement.phase = "OFF-confirmed";
      assetPhase = `${version}-warm-worker-assets-after-cache`;
      const warmAssetStartIndex = httpAssetResponses.length;
      const warmStartedAt = performance.now();
      await completionSwitch.click();
      await expect(page.getByText("On", { exact: true })).toBeVisible();
      activeMeasurement.phase = "ON-confirmed-waiting-for-distinct-worker";
      const warmWorkerId = await readyWorkerId(page, version, coldWorkerId);
      const warmReadyMs = performance.now() - warmStartedAt;
      activeMeasurement.warmWorkerId = warmWorkerId;
      activeMeasurement.warmReadyMs = warmReadyMs;
      const warmReady = (await lspObservations(page))
        .filter(
          (event) =>
            event.direction === "ready" && event.workerId === warmWorkerId,
        )
        .at(-1);
      expect(warmReady?.wasmSha256).toBe(generatedAnalysisAsset.wasmSha256);
      activeMeasurement.warmReady = warmReady;
      activeMeasurement.phase = "warm-worker-ready";

      assetPhase = `${version}-warm-query`;
      await editRuby(page, `puts "warm-${version}"`);
      const warmQueryStartedAt = performance.now();
      await page.keyboard.type(".upc");
      const warmCandidate = page
        .getByRole("listbox", { name: "Suggest" })
        .getByRole("listitem", { name: "upcase, Method", exact: true });
      await expect(warmCandidate).toBeVisible({ timeout: 30_000 });
      const warmCandidateUiMs = performance.now() - warmQueryStartedAt;
      activeMeasurement.warmCandidateUiMs = warmCandidateUiMs;
      await warmCandidate.click();
      await expect(page.locator(".monaco-editor .view-line")).toHaveText(
        `puts "warm-${version}".upcase`,
      );
      await expectRubyOutput(page, `WARM-${version}\n`);
      await page.screenshot({
        path: testInfo.outputPath(`warm-upcase-${version}.png`),
      });

      const observations = await lspObservations(page);
      const versionEvents = observations.filter(
        (event) =>
          [coldWorkerId, warmWorkerId].includes(event.workerId as number) &&
          (event.direction === "ready" ||
            ((event.direction === "request" ||
              event.direction === "response") &&
              event.method === "textDocument/completion")),
      );
      const completionResponses = versionEvents
        .filter(
          (event) =>
            event.direction === "response" &&
            event.method === "textDocument/completion",
        )
        .map((event) => ({
          workerId: event.workerId,
          token: event.token,
          documentVersion: event.documentVersion,
          responseMs: event.responseMs,
          workerElapsedMs: event.workerElapsedMs,
          candidateCount: event.candidateCount,
        }));
      Object.assign(activeMeasurement, {
        version,
        coldWorkerId,
        firstWorkerCacheState:
          version === "3.3"
            ? "fresh test browser context"
            : "same browser context after 3.3 assets were fetched",
        firstWorkerReadyMs,
        coldInitializationMs: (
          coldReady?.timings as { initializationMs?: number } | undefined
        )?.initializationMs,
        coldCandidateUiMs,
        warmWorkerId,
        warmReadyMs,
        warmInitializationMs: (
          warmReady?.timings as { initializationMs?: number } | undefined
        )?.initializationMs,
        warmCandidateUiMs,
        workerReady: [coldReady, warmReady],
        completionResponses,
        httpAssets: await Promise.all(
          httpAssetResponses.slice(versionAssetStartIndex),
        ),
        warmWorkerHttpAssets: await Promise.all(
          httpAssetResponses.slice(warmAssetStartIndex),
        ),
      });
      activeMeasurement.phase = "warm-query-complete";
    }
  } catch (error) {
    metrics.failure = error instanceof Error ? error.message : String(error);
    metrics.failureStack = error instanceof Error ? error.stack : undefined;
    if (activeMeasurement)
      activeMeasurement.failurePhase = activeMeasurement.phase;
    throw error;
  } finally {
    metrics.finishedAt = new Date().toISOString();
    metrics.finalPhase = activeMeasurement?.phase ?? assetPhase;
    metrics.partialWorkerObservations = await lspObservations(page).catch(
      (error) => ({ readError: String(error) }),
    );
    metrics.partialHttpAssets = await Promise.all(httpAssetResponses);
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
  }
});

test("OFF and Ruby version changes dispose and recreate analysis workers", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await watchAnalysisWorkers(page);
  await page.goto(codeOnlyUrl("", "4.0"));
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
  const provenance = await captureE2eSourceProvenance(testInfo);
  await mkdir(testInfo.outputPath(), { recursive: true });
  await watchAnalysisWorkers(page, {
    holdCompletionResponses: { documentSuffix: ".upc" },
  });
  const record: Record<string, unknown> = {
    actualGitHead: provenance.actualGitHead,
    runtimeHead: process.env.COMPLETION_RUNTIME_COMMIT ?? null,
    testSourceSha256: provenance.testSourceSha256,
    observerSourceSha256: provenance.observerSourceSha256,
    startedAt: Date.now(),
  };

  try {
    await page.goto(codeOnlyUrl("", "4.0"));
    await expect(page.getByText("On", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const workerId = await readyWorkerId(page, "4.0");
    const responseStart = (await lspObservations(page)).length;
    await editRuby(page, 'puts "hello"');
    await page.keyboard.type(".upc");
    const source = 'puts "hello".upc';
    let finalHeld:
      Awaited<ReturnType<typeof heldCompletionResponses>>[number] | undefined;
    await expect
      .poll(
        async () => {
          const events = await lspObservations(page);
          const documentEvent = events
            .slice(responseStart)
            .filter(
              (event) =>
                event.direction === "notification" &&
                event.method === "textDocument/didChange" &&
                normalizeCompletionSource(
                  (
                    event.contentChanges as Array<{ text?: string }> | undefined
                  )?.at(-1)?.text ?? "",
                ) === normalizeCompletionSource(source),
            )
            .at(-1);
          if (!documentEvent) return false;
          const request = events.find(
            (event) =>
              event.direction === "request" &&
              event.method === "textDocument/completion" &&
              event.workerId === workerId &&
              event.documentVersion === documentEvent.documentVersion &&
              JSON.stringify(event.position) ===
                JSON.stringify({ line: 0, character: source.length }),
          );
          if (!request) return false;
          finalHeld = (await heldCompletionResponses(page)).find(
            (held) =>
              held.workerId === request.workerId &&
              held.token === request.token &&
              held.documentVersion === documentEvent.documentVersion &&
              JSON.stringify(held.position) ===
                JSON.stringify({ line: 0, character: source.length }),
          );
          if (!finalHeld) return false;
          const envelope = finalHeld.response as {
            error?: unknown;
            responses?: Array<{
              id?: number;
              result?: { items?: Array<{ label?: string }> };
              error?: unknown;
            }>;
          };
          const rpcResponse = envelope.responses?.find(
            (response) => typeof response.id === "number",
          );
          return (
            envelope.error === undefined &&
            rpcResponse?.error === undefined &&
            Array.isArray(rpcResponse?.result?.items) &&
            rpcResponse.result.items.some((item) => item.label === "upcase") &&
            finalHeld.candidateLabels.includes("upcase")
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    const held = await heldCompletionResponses(page);
    record.heldBeforeOff = held;
    record.requestsBeforeOff = await lspObservations(page);
    const delayedCompletion = finalHeld;
    expect(delayedCompletion).toBeDefined();
    expect(delayedCompletion?.documentText).toBe(source);
    expect(delayedCompletion?.observerMessageListenerCount).toBe(1);
    expect(delayedCompletion?.clientMessageListenerCount).toBe(1);
    expect(delayedCompletion?.clientDeliveriesBeforeRelease).toBe(0);
    expect(delayedCompletion?.candidateLabels).toContain("upcase");
    await expectHeldClientDeliveryProof(
      page,
      delayedCompletion?.workerId as number,
      delayedCompletion?.token as number,
      false,
    );
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
      expect(response.method).toBe("textDocument/completion");
      expect(response.observerMessageListenerCount).toBe(1);
      expect(response.clientMessageListenerCount).toBe(1);
      expect(response.clientDeliveriesBeforeRelease).toBe(0);
      await expectHeldClientDeliveryProof(
        page,
        response.workerId,
        response.token,
        false,
      );
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
      expect(releaseSucceeded).toBe(true);
      await expectHeldClientDeliveryProof(
        page,
        response.workerId,
        response.token,
        true,
      );
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
    record.finalClientMessageDeliveries = await page
      .evaluate(
        () =>
          (window as unknown as { __clientMessageDeliveries?: unknown[] })
            .__clientMessageDeliveries ?? [],
      )
      .catch((error) => String(error));
    record.finalHeldResponses = await heldCompletionResponses(page).catch(
      (error) => String(error),
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
  await page.goto(codeOnlyUrl("", "4.0"));
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
    await page.goto(codeOnlyUrl("", version));
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
