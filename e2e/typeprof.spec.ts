import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { captureE2eSourceProvenance } from "./provenance";
import {
  codeOnlyUrl,
  editRuby,
  expectEditorSource,
  expectRubyOutput,
} from "./editor";
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

type Position = { line: number; character: number };
type TextEdit = {
  range?: { start?: Position; end?: Position };
  newText?: string;
};
type RawCandidate = {
  label?: string;
  kind?: number;
  detail?: string;
  textEdit?: TextEdit;
};
type CompletionResponse = Record<string, unknown> & {
  workerId?: number;
  token?: number;
  documentVersion?: number;
  position?: Position;
  candidates?: RawCandidate[];
};

type CompletionSnapshot = {
  documentEvent: Record<string, unknown>;
  request: Record<string, unknown>;
  response: CompletionResponse;
};

type TypeInferenceCase = {
  name: string;
  codeBeforePrefix: string;
  prefix: string;
  cursorLeft?: number;
  sourceAfterPrefix: string;
  expectedPosition: Position;
  label: string;
  detailPattern?: RegExp;
  codeAfterSelection: string;
  output: string;
};

const versions = ["3.3", "4.0"] as const;

async function waitForHeldCompletionForSource(
  page: Page,
  {
    responseStart,
    workerId,
    source,
    position,
  }: {
    responseStart: number;
    workerId: number;
    source: string;
    position: Position;
  },
) {
  let heldResponse:
    Awaited<ReturnType<typeof heldCompletionResponses>>[number] | undefined;
  await expect
    .poll(async () => {
      const events = await lspObservations(page);
      const documentEvent = events
        .slice(responseStart)
        .filter(
          (event) =>
            event.direction === "notification" &&
            event.workerId === workerId &&
            (event.method === "textDocument/didOpen" ||
              event.method === "textDocument/didChange") &&
            normalizeCompletionSource(
              (
                event.contentChanges as Array<{ text?: string }> | undefined
              )?.at(-1)?.text ??
                (event.textDocument as { text?: string } | undefined)?.text ??
                "",
            ) === normalizeCompletionSource(source),
        )
        .at(-1);
      if (!documentEvent) return false;
      const request = events.find(
        (event) =>
          event.direction === "request" &&
          event.workerId === workerId &&
          event.method === "textDocument/completion" &&
          event.documentVersion === documentEvent.documentVersion &&
          JSON.stringify(event.position) === JSON.stringify(position),
      );
      if (!request) return false;
      const response = events.find(
        (event) =>
          event.direction === "response" &&
          event.workerId === workerId &&
          event.token === request.token &&
          event.method === "textDocument/completion",
      );
      if (
        !(response?.candidates as RawCandidate[] | undefined)?.some(
          (candidate) => candidateLabel(candidate) === "upcase",
        )
      )
        return false;
      heldResponse = (await heldCompletionResponses(page)).find(
        (held) =>
          held.workerId === workerId &&
          held.token === request.token &&
          held.documentVersion === documentEvent.documentVersion &&
          JSON.stringify(held.position) === JSON.stringify(position),
      );
      return Boolean(heldResponse);
    })
    .toBe(true);

  expect(heldResponse).toBeDefined();
  expect(heldResponse?.documentText).toBe(source);
  expect(heldResponse?.documentVersion).toBeDefined();
  expect(heldResponse?.observerMessageListenerCount).toBe(1);
  expect(heldResponse?.clientMessageListenerCount).toBe(1);
  expect(heldResponse?.clientDeliveriesBeforeRelease).toBe(0);
  expect(heldResponse?.candidateLabels).toContain("upcase");
  await expectHeldClientDeliveryProof(
    page,
    workerId,
    heldResponse?.token as number,
    false,
  );
  return heldResponse as Awaited<
    ReturnType<typeof heldCompletionResponses>
  >[number];
}

const typeInferenceCases: TypeInferenceCase[] = [
  {
    name: "method return type",
    codeBeforePrefix: 'def greeting; "hello"; end\nputs greeting',
    prefix: ".upc",
    sourceAfterPrefix: 'def greeting; "hello"; end\nputs greeting.upc',
    expectedPosition: { line: 1, character: 17 },
    label: "upcase",
    detailPattern: /String#upcase/,
    codeAfterSelection: 'def greeting; "hello"; end\nputs greeting.upcase',
    output: "HELLO\n",
  },
  {
    name: "Array#first element type",
    codeBeforePrefix: 'words = ["hello", "world"]\nputs words.first',
    prefix: ".upc",
    sourceAfterPrefix: 'words = ["hello", "world"]\nputs words.first.upc',
    expectedPosition: { line: 1, character: 20 },
    label: "upcase",
    detailPattern: /String#upcase/,
    codeAfterSelection: 'words = ["hello", "world"]\nputs words.first.upcase',
    output: "HELLO\n",
  },
  {
    name: "map block argument type",
    codeBeforePrefix: 'words = ["hello"]\nputs words.map { |word| word }',
    prefix: ".upc",
    cursorLeft: 2,
    sourceAfterPrefix: 'words = ["hello"]\nputs words.map { |word| word.upc }',
    expectedPosition: { line: 1, character: 32 },
    label: "upcase",
    detailPattern: /String#upcase/,
    codeAfterSelection:
      'words = ["hello"]\nputs words.map { |word| word.upcase }',
    output: "HELLO\n",
  },
];

function candidateLabel(candidate: RawCandidate): string | undefined {
  return typeof candidate.label === "string" ? candidate.label : undefined;
}

function visibleCandidateLabel(page: Page, label: string) {
  return page
    .getByRole("listbox", { name: "Suggest" })
    .locator(".monaco-list-row .label-name")
    .getByText(label, { exact: true });
}

async function selectVisibleCandidateByKeyboard(page: Page, label: string) {
  await expect(visibleCandidateLabel(page, label)).toBeVisible();
  const rows = page.locator(".suggest-widget .monaco-list-row");
  const focusedLabel = page.locator(
    ".suggest-widget .monaco-list-row.focused .label-name",
  );
  const rowCount = await rows.count();
  for (let index = 0; index <= rowCount; index += 1) {
    if ((await focusedLabel.textContent().catch(() => ""))?.trim() === label) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(
    `Could not focus the exact visible completion label ${label}`,
  );
}

async function waitForReadyVersion(
  page: Page,
  version: (typeof versions)[number],
  afterReadyCount = 0,
  previousWorkerId?: number,
): Promise<Record<string, unknown>> {
  await expect(page.getByLabel("Ruby version")).toHaveValue(version);
  await expect(page.getByText("On", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(
      async () => {
        const readyEvents = (await lspObservations(page)).filter(
          (event) => event.direction === "ready",
        );
        return readyEvents
          .slice(afterReadyCount)
          .some(
            (event) =>
              event.version === version &&
              (previousWorkerId === undefined ||
                event.workerId !== previousWorkerId),
          );
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  const readyEvents = (await lspObservations(page)).filter(
    (event) => event.direction === "ready",
  );
  const ready = readyEvents
    .slice(afterReadyCount)
    .find(
      (event) =>
        event.version === version &&
        (previousWorkerId === undefined || event.workerId !== previousWorkerId),
    );
  expect(ready).toBeDefined();
  return ready as Record<string, unknown>;
}

async function typeAndSelectTypeProfCandidate(
  page: Page,
  {
    prefix,
    label,
    detailPattern,
    responseStart,
    workerId,
    source,
    expectedPosition,
    onTyped,
    selection = "click",
  }: {
    prefix: string;
    label: string;
    detailPattern?: RegExp;
    responseStart: number;
    workerId: number;
    source: string;
    expectedPosition: Position;
    onTyped?: () => Promise<void>;
    selection?: "click" | "keyboard";
  },
): Promise<{ event: CompletionResponse; item: RawCandidate }> {
  await page.keyboard.type(prefix, { delay: 50 });
  await onTyped?.();
  const snapshot = await waitForSnapshotCandidate(page, {
    responseStart,
    workerId,
    source,
    position: expectedPosition,
    label,
  });
  const event = snapshot.response;
  const item = snapshot.item;
  expect(item).toBeDefined();
  if (detailPattern) expect(item?.detail).toMatch(detailPattern);
  expect(event?.workerId).toBeDefined();
  expect(event?.documentVersion).toBeDefined();
  expect(event.position).toEqual(expectedPosition);

  // The accessible row name can include TypeProf documentation details. Match
  // the exact visible label node so `upcase` cannot select `upcase!`.
  const candidateName = visibleCandidateLabel(page, label);
  await expect(candidateName).toHaveCount(1, { timeout: 30_000 });
  await expect(candidateName).toBeVisible();
  if (selection === "keyboard")
    await selectVisibleCandidateByKeyboard(page, label);
  else await candidateName.click();
  return { event: event as CompletionResponse, item: item as RawCandidate };
}

async function waitForSnapshotCandidate(
  page: Page,
  {
    responseStart,
    workerId,
    source,
    position,
    label,
  }: {
    responseStart: number;
    workerId: number;
    source: string;
    position: Position;
    label: string;
  },
): Promise<{
  documentEvent: Record<string, unknown>;
  request: Record<string, unknown>;
  response: CompletionResponse;
  item: RawCandidate;
}> {
  let snapshot: ReturnType<typeof completionResponseForSnapshot>;
  await expect
    .poll(async () => {
      snapshot = completionResponseForSnapshot(
        (await lspObservations(page)).slice(responseStart),
        { workerId, source, position },
      );
      return Boolean(
        snapshot &&
        isSuccessfulCompletionResponse(snapshot.response) &&
        (snapshot.response.candidates as RawCandidate[] | undefined)?.some(
          (candidate) => candidateLabel(candidate) === label,
        ),
      );
    })
    .toBe(true);
  expect(snapshot).toBeDefined();
  expect(isSuccessfulCompletionResponse(snapshot!.response)).toBe(true);
  const item = (
    snapshot!.response.candidates as RawCandidate[] | undefined
  )?.find((candidate) => candidateLabel(candidate) === label);
  expect(item).toBeDefined();
  return {
    documentEvent: snapshot!.documentEvent,
    request: snapshot!.request,
    response: snapshot!.response as CompletionResponse,
    item: item as RawCandidate,
  };
}

async function waitForSnapshotResponse(
  page: Page,
  {
    responseStart,
    workerId,
    source,
    position,
  }: {
    responseStart: number;
    workerId: number;
    source: string;
    position: Position;
  },
): Promise<CompletionSnapshot> {
  let snapshot: ReturnType<typeof completionResponseForSnapshot>;
  await expect
    .poll(
      async () => {
        const events = (await lspObservations(page)).slice(responseStart);
        snapshot = completionResponseForSnapshot(events, {
          workerId,
          source,
          position,
        });
        if (!snapshot) {
          const held = (await heldCompletionResponses(page)).find(
            (entry) =>
              entry.workerId === workerId &&
              entry.method === "textDocument/completion" &&
              normalizeCompletionSource(entry.documentText ?? "") ===
                normalizeCompletionSource(source) &&
              entry.position !== undefined &&
              JSON.stringify(entry.position) === JSON.stringify(position),
          );
          if (!held) return false;
          const documentEvent = events
            .filter(
              (event) =>
                event.direction === "notification" &&
                event.workerId === workerId &&
                event.documentVersion === held.documentVersion &&
                normalizeCompletionSource(
                  (
                    event.contentChanges as Array<{ text?: string }> | undefined
                  )?.at(-1)?.text ?? "",
                ) === normalizeCompletionSource(source),
            )
            .at(-1);
          const request = events.find(
            (event) =>
              event.direction === "request" &&
              event.workerId === workerId &&
              event.token === held.token &&
              event.method === "textDocument/completion" &&
              event.documentVersion === held.documentVersion &&
              JSON.stringify(event.position) === JSON.stringify(position),
          );
          if (!documentEvent || !request) return false;
          const envelope = held.response as {
            error?: unknown;
            responses?: Array<{
              id?: number;
              result?: unknown;
              error?: unknown;
            }>;
          };
          const rpc = envelope.responses?.find(
            (entry) => typeof entry.id === "number",
          );
          const result = rpc?.result;
          const items = Array.isArray(result)
            ? result
            : result &&
                typeof result === "object" &&
                Array.isArray((result as { items?: unknown }).items)
              ? (result as { items: unknown[] }).items
              : result && typeof result === "object" && "label" in result
                ? [result]
                : undefined;
          if (!items) return false;
          const candidates = items.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object" && "label" in item,
          );
          const successfulResult =
            envelope.error === undefined &&
            rpc?.error === undefined &&
            candidates.length === items.length;
          snapshot = {
            documentEvent,
            request,
            response: {
              direction: "response",
              workerId,
              token: held.token,
              method: "textDocument/completion",
              documentVersion: held.documentVersion,
              position: held.position,
              candidates,
              successfulResult,
              deliveryState: "held-before-client",
            } as CompletionResponse,
          };
        }
        return Boolean(snapshot);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(snapshot).toBeDefined();
  expect(isSuccessfulCompletionResponse(snapshot!.response)).toBe(true);
  return snapshot as CompletionSnapshot;
}

for (const version of versions) {
  test(`TypeProf naturally completes put as puts and executes on Ruby ${version}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(45_000);
    const provenance = await captureE2eSourceProvenance(testInfo);
    const diagnostic: Record<string, unknown> = {
      actualGitHead: provenance.actualGitHead,
      runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? null,
      testSourceSha256: provenance.testSourceSha256,
      observerSourceSha256: provenance.observerSourceSha256,
      version,
      startedAt: Date.now(),
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
      await page.goto(codeOnlyUrl("", version));
      const ready = await waitForReadyVersion(page, version);
      diagnostic.ready = ready;
      await editRuby(page, 'pu "Ruby"');
      for (let index = 0; index < 7; index += 1)
        await page.keyboard.press("ArrowLeft");
      const responseStart = (await lspObservations(page)).length;
      diagnostic.prefixBeforeNaturalInput = await page
        .locator(".monaco-editor .view-lines")
        .innerText();
      await page.keyboard.type("t");
      await expectEditorSource(page, 'put "Ruby"');
      const { event, item } = await typeAndSelectTypeProfCandidate(page, {
        prefix: "",
        label: "puts",
        responseStart,
        workerId: ready.workerId as number,
        source: 'put "Ruby"',
        expectedPosition: { line: 0, character: 3 },
      });
      expect(item.textEdit).toEqual({
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 3 },
        },
        newText: "puts",
      });
      diagnostic.finalCompletionResponse = event;
      diagnostic.putsCandidate = item;
      await expectEditorSource(page, 'puts "Ruby"');
      diagnostic.selectedSource = 'puts "Ruby"';
      await expectRubyOutput(page, "Ruby\n");
      diagnostic.output = await page
        .getByTestId("preview-console")
        .textContent();
      diagnostic.result = "passed";
      await page.screenshot({ path: testInfo.outputPath("puts-inserted.png") });
    } catch (error) {
      diagnostic.failure =
        error instanceof Error ? error.message : String(error);
      diagnostic.failureStack =
        error instanceof Error ? error.stack : undefined;
      throw error;
    } finally {
      diagnostic.finishedAt = Date.now();
      diagnostic.observations = await lspObservations(page).catch((error) =>
        String(error),
      );
      diagnostic.finalEditor = await page
        .evaluate(() => ({
          source: [...document.querySelectorAll(".monaco-editor .view-line")]
            .map((line) => (line.textContent ?? "").replace(/\u00a0/g, " "))
            .join("\n"),
          completionStatus: document.querySelector(
            '[role="status"][aria-label^="Code completion status:"]',
          )?.textContent,
          output: document.querySelector('[data-testid="preview-console"]')
            ?.textContent,
        }))
        .catch((error) => String(error));
      await page
        .screenshot({ path: testInfo.outputPath("puts-final.png") })
        .catch((error) => {
          diagnostic.screenshotFailure = String(error);
        });
      const diagnosticPath = testInfo.outputPath("puts-diagnostic.json");
      const serialized = JSON.stringify(diagnostic, null, 2);
      await mkdir(dirname(diagnosticPath), { recursive: true });
      await writeFile(diagnosticPath, serialized, "utf8");
      await testInfo
        .attach("puts-diagnostic.json", {
          path: diagnosticPath,
          contentType: "application/json",
        })
        .catch(() => undefined);
    }
  });
}

for (const version of versions) {
  test(`TypeProf removes a deleted Mine method without hiding version-specific Array rfind on Ruby ${version}`, async ({
    page,
  }) => {
    await watchAnalysisWorkers(page);
    await page.goto(codeOnlyUrl("", version));
    const ready = await waitForReadyVersion(page, version);
    const workerId = ready.workerId as number;

    const initialSource =
      'class Mine; def rfind; "mine"; end; end\nputs Mine.new.';
    await editRuby(page, initialSource);
    const initialResponseStart = (await lspObservations(page)).length;
    const initial = await typeAndSelectTypeProfCandidate(page, {
      prefix: "rf",
      label: "rfind",
      detailPattern: /Mine#rfind/,
      responseStart: initialResponseStart,
      workerId,
      source: `${initialSource}rf`,
      expectedPosition: { line: 1, character: 16 },
    });
    expect(initial.item.textEdit?.newText).toBe("rfind");
    const declaredSource =
      'class Mine; def rfind; "mine"; end; end\nputs Mine.new.rfind';
    await expectEditorSource(page, declaredSource);
    await expectRubyOutput(page, "mine\n");

    const removedSource = "class Mine; end\nputs Mine.new.";
    await editRuby(page, removedSource);
    const removedResponseStart = (await lspObservations(page)).length;
    await page.keyboard.type("rf", { delay: 50 });
    const removed = await waitForSnapshotResponse(page, {
      responseStart: removedResponseStart,
      workerId,
      source: `${removedSource}rf`,
      position: { line: 1, character: 16 },
    });
    expect(removed.response.candidates?.map(candidateLabel)).not.toContain(
      "rfind",
    );
    await expectEditorSource(page, `${removedSource}rf`);
    await expect(visibleCandidateLabel(page, "rfind")).toHaveCount(0);

    const arraySource = "puts [1,2].";
    await editRuby(page, arraySource);
    const arrayResponseStart = (await lspObservations(page)).length;
    await page.keyboard.type("rf", { delay: 50 });
    const arrayResponse = await waitForSnapshotResponse(page, {
      responseStart: arrayResponseStart,
      workerId,
      source: `${arraySource}rf`,
      position: { line: 0, character: 13 },
    });
    const arrayHasRfind = Boolean(
      arrayResponse.response.candidates?.some(
        (candidate) => candidateLabel(candidate) === "rfind",
      ),
    );
    expect(arrayHasRfind).toBe(version === "4.0");
    if (version === "4.0")
      await expect(visibleCandidateLabel(page, "rfind")).toBeVisible();
    else await expect(visibleCandidateLabel(page, "rfind")).toHaveCount(0);
  });
}

test("TypeProf correlates an API-negative response after releasing an older positive response", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const provenance = await captureE2eSourceProvenance(testInfo);
  const diagnostic: Record<string, unknown> = {
    actualGitHead: provenance.actualGitHead,
    runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? null,
    testSourceSha256: provenance.testSourceSha256,
    observerSourceSha256: provenance.observerSourceSha256,
    version: "3.3",
    startedAt: Date.now(),
  };
  const pageErrors: string[] = [];
  page.on("pageerror", (error) =>
    pageErrors.push(error.stack ?? error.message),
  );
  await watchAnalysisWorkers(page, {
    holdCompletionResponses: { documentSuffix: ".upc" },
  });

  try {
    await page.goto(codeOnlyUrl("", "3.3"));
    const ready = await waitForReadyVersion(page, "3.3");
    const workerId = ready.workerId as number;

    const oldSource = 'puts "old"';
    await editRuby(page, oldSource);
    const oldResponseStart = (await lspObservations(page)).length;
    await page.keyboard.type(".upc", { delay: 50 });
    const oldSnapshot = await waitForSnapshotResponse(page, {
      responseStart: oldResponseStart,
      workerId,
      source: `${oldSource}.upc`,
      position: { line: 0, character: 14 },
    });
    expect(oldSnapshot.response.candidates?.map(candidateLabel)).toContain(
      "upcase",
    );
    const oldHeld = (await heldCompletionResponses(page)).find(
      (held) =>
        held.workerId === workerId && held.token === oldSnapshot.request.token,
    );
    expect(oldHeld?.documentText).toBe(`${oldSource}.upc`);
    expect(oldHeld?.documentVersion).toBe(
      oldSnapshot.documentEvent.documentVersion,
    );
    expect(oldHeld?.clientDeliveriesBeforeRelease).toBe(0);
    await expectHeldClientDeliveryProof(
      page,
      workerId,
      oldSnapshot.request.token as number,
      false,
    );

    const negativeBase = "box = Object.new\nputs box";
    await editRuby(page, negativeBase);
    expect(
      await releaseHeldCompletionResponse(page, workerId, oldHeld!.token),
    ).toBe(true);
    await expectHeldClientDeliveryProof(page, workerId, oldHeld!.token, true);
    await expectEditorSource(page, negativeBase);
    await expect(page.getByRole("listbox", { name: "Suggest" })).toHaveCount(0);

    const negativeResponseStart = (await lspObservations(page)).length;
    await page.keyboard.type(".upc", { delay: 50 });
    const negativeSource = `${negativeBase}.upc`;
    const negativeSnapshot = await waitForSnapshotResponse(page, {
      responseStart: negativeResponseStart,
      workerId,
      source: negativeSource,
      position: { line: 1, character: 12 },
    });
    expect(
      negativeSnapshot.response.candidates?.map(candidateLabel),
    ).not.toContain("upcase");
    const negativeHeld = (await heldCompletionResponses(page)).find(
      (held) =>
        held.workerId === workerId &&
        held.token === negativeSnapshot.request.token,
    );
    expect(normalizeCompletionSource(negativeHeld?.documentText ?? "")).toBe(
      normalizeCompletionSource(negativeSource),
    );
    expect(
      await releaseHeldCompletionResponse(
        page,
        workerId,
        negativeSnapshot.request.token as number,
      ),
    ).toBe(true);
    await expectHeldClientDeliveryProof(
      page,
      workerId,
      negativeSnapshot.request.token as number,
      true,
    );
    await expectEditorSource(page, negativeSource);
    await expect(visibleCandidateLabel(page, "upcase")).toHaveCount(0);
    await editRuby(page, "box = Object.new\nputs box.class");
    await expectRubyOutput(page, "Object\n");
    diagnostic.result = "passed";
    diagnostic.oldPositiveSnapshot = oldSnapshot;
    diagnostic.negativeSnapshot = negativeSnapshot;
    diagnostic.heldResponses = await heldCompletionResponses(page);
  } catch (error) {
    diagnostic.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    diagnostic.finishedAt = Date.now();
    diagnostic.pageErrors = pageErrors;
    diagnostic.observations = await lspObservations(page).catch((error) =>
      String(error),
    );
    const diagnosticPath = testInfo.outputPath(
      "api-negative-stale-response.json",
    );
    await mkdir(dirname(diagnosticPath), { recursive: true });
    await writeFile(
      diagnosticPath,
      JSON.stringify(diagnostic, null, 2),
      "utf8",
    );
    await testInfo.attach("api-negative-stale-response.json", {
      path: diagnosticPath,
      contentType: "application/json",
    });
  }
});

for (const version of versions) {
  for (const inferenceCase of typeInferenceCases) {
    test(`TypeProf ${inferenceCase.name} completion inserts and executes on Ruby ${version}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(45_000);
      const startedAt = Date.now();
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const diagnostic: Record<string, unknown> = {
        head: process.env.COMPLETION_UI_HEAD ?? "not-recorded",
        runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
        version,
        case: inferenceCase.name,
        startedAt,
        pageErrors,
        consoleErrors,
      };
      page.on("pageerror", (error) =>
        pageErrors.push(error.stack ?? error.message),
      );
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await watchAnalysisWorkers(page);
      try {
        await page.goto(codeOnlyUrl("", version));
        const ready = await waitForReadyVersion(page, version);
        diagnostic.ready = ready;
        await editRuby(page, inferenceCase.codeBeforePrefix);
        for (let index = 0; index < (inferenceCase.cursorLeft ?? 0); index += 1)
          await page.keyboard.press("ArrowLeft");
        const responseStart = (await lspObservations(page)).length;
        diagnostic.inputStartedAt = await page.evaluate(() =>
          performance.now(),
        );

        const { event } = await typeAndSelectTypeProfCandidate(page, {
          prefix: inferenceCase.prefix,
          label: inferenceCase.label,
          detailPattern: inferenceCase.detailPattern,
          responseStart,
          workerId: ready.workerId as number,
          source: inferenceCase.sourceAfterPrefix,
          expectedPosition: inferenceCase.expectedPosition,
          onTyped: async () => {
            diagnostic.typedAt = Date.now();
            diagnostic.monotonicTypedAt = await page.evaluate(() =>
              performance.now(),
            );
            diagnostic.inputAfterNaturalTyping = await page
              .evaluate(() => {
                const source = [
                  ...document.querySelectorAll(".monaco-editor .view-line"),
                ]
                  .map((line) => line.textContent ?? "")
                  .join("\n");
                const input = document.querySelector(
                  ".monaco-editor textarea.inputarea",
                ) as HTMLTextAreaElement | null;
                return {
                  source,
                  inputValue: input?.value,
                  selectionStart: input?.selectionStart,
                  selectionEnd: input?.selectionEnd,
                  activeElementClass: (
                    document.activeElement as HTMLElement | null
                  )?.className,
                };
              })
              .catch((error) => String(error));
          },
        });

        diagnostic.completionResponse = event;
        await expectEditorSource(page, inferenceCase.codeAfterSelection);
        await expectRubyOutput(page, inferenceCase.output);
        expect(event.documentVersion).toBeDefined();
        diagnostic.result = "passed";
      } catch (error) {
        diagnostic.failure =
          error instanceof Error ? error.message : String(error);
        diagnostic.failureStack =
          error instanceof Error ? error.stack : undefined;
        throw error;
      } finally {
        diagnostic.finishedAt = Date.now();
        let observations = await lspObservations(page).catch((error) =>
          String(error),
        );
        diagnostic.observationsAtAssertionEnd = observations;
        if (Array.isArray(observations)) {
          const ready = diagnostic.ready as Record<string, unknown> | undefined;
          const completionRequests = observations.filter(
            (event) =>
              event.direction === "request" &&
              event.method === "textDocument/completion" &&
              event.workerId === ready?.workerId,
          );
          const latestRequest = completionRequests.at(-1);
          const matchingResponse = latestRequest
            ? observations.some(
                (event) =>
                  event.direction === "response" &&
                  event.workerId === latestRequest.workerId &&
                  event.token === latestRequest.token,
              )
            : false;
          diagnostic.completionRequestsOnReadyWorker = completionRequests;
          diagnostic.latestRequestHasResponse = matchingResponse;
          if (latestRequest && !matchingResponse) {
            const elapsedSinceRequest = await page
              .evaluate(
                (requestAt) => performance.now() - Number(requestAt),
                latestRequest.at,
              )
              .catch(() => 8_000);
            const remainingUntilRuntimeDeadline = Math.max(
              0,
              8_000 - elapsedSinceRequest,
            );
            diagnostic.remainingToEightSecondDeadlineMs =
              remainingUntilRuntimeDeadline;
            if (remainingUntilRuntimeDeadline > 0) {
              await page.waitForTimeout(remainingUntilRuntimeDeadline);
            }
          }
          observations = await lspObservations(page).catch((error) =>
            String(error),
          );
        }
        diagnostic.observations = observations;
        diagnostic.protocol = Array.isArray(observations)
          ? observations.filter(
              (event) =>
                event.method === "textDocument/completion" ||
                event.direction === "initialize" ||
                event.direction === "ready" ||
                event.direction === "fatal",
            )
          : observations;
        diagnostic.editor = await page
          .evaluate(() => {
            const source = [
              ...document.querySelectorAll(".monaco-editor .view-line"),
            ]
              .map((line) => line.textContent ?? "")
              .join("\n");
            const input = document.querySelector(
              ".monaco-editor textarea.inputarea",
            ) as HTMLTextAreaElement | null;
            return {
              source,
              activeElementClass: (document.activeElement as HTMLElement | null)
                ?.className,
              inputValue: input?.value,
              selectionStart: input?.selectionStart,
              selectionEnd: input?.selectionEnd,
            };
          })
          .catch((error) => String(error));
        diagnostic.suggestionRows = await page
          .locator(".suggest-widget .monaco-list-row")
          .evaluateAll((rows) =>
            rows.map((row) => ({
              text: row.textContent,
              ariaLabel: row.getAttribute("aria-label"),
              visible: row.getBoundingClientRect().width > 0,
            })),
          )
          .catch((error) => String(error));
        await page
          .screenshot({
            path: testInfo.outputPath("typeprof-return-final.png"),
          })
          .catch((error) => {
            diagnostic.screenshotFailure = String(error);
          });
        const diagnosticPath = testInfo.outputPath(
          "typeprof-return-diagnostic.json",
        );
        let serializedDiagnostic: string;
        try {
          serializedDiagnostic = JSON.stringify(diagnostic, null, 2);
        } catch (error) {
          serializedDiagnostic = JSON.stringify(
            {
              head: diagnostic.head,
              runtime: diagnostic.runtime,
              version: diagnostic.version,
              case: diagnostic.case,
              startedAt: diagnostic.startedAt,
              finishedAt: diagnostic.finishedAt,
              failure: diagnostic.failure,
              diagnosticSerializationFailure:
                error instanceof Error ? error.stack : String(error),
            },
            null,
            2,
          );
        }
        try {
          await mkdir(dirname(diagnosticPath), { recursive: true });
          await writeFile(diagnosticPath, serializedDiagnostic, "utf8");
        } catch (error) {
          console.error("Failed to persist TypeProf diagnostic JSON", error);
        }
        await testInfo
          .attach("typeprof-return-diagnostic.json", {
            path: diagnosticPath,
            contentType: "application/json",
          })
          .catch((error: unknown) => {
            console.error("Failed to attach TypeProf diagnostic JSON", error);
          });
      }
    });
  }

  test(`TypeProf infers local and custom methods but does not invent an unknown receiver method on Ruby ${version}`, async ({
    page,
  }) => {
    await watchAnalysisWorkers(page);
    await page.goto(codeOnlyUrl("", version));
    const ready = await waitForReadyVersion(page, version);

    await editRuby(page, 'greeting = "hi"\nputs ');
    let responseStart = (await lspObservations(page)).length;
    await typeAndSelectTypeProfCandidate(page, {
      prefix: "gree",
      label: "greeting",
      responseStart,
      workerId: ready.workerId as number,
      source: 'greeting = "hi"\nputs gree',
      expectedPosition: { line: 1, character: 9 },
    });
    await expectEditorSource(page, 'greeting = "hi"\nputs greeting');
    await expectRubyOutput(page, "hi\n");

    await editRuby(
      page,
      'class Greeter; def salutation; "hi"; end; end\nputs Greeter.new',
    );
    responseStart = (await lspObservations(page)).length;
    await typeAndSelectTypeProfCandidate(page, {
      prefix: ".sal",
      label: "salutation",
      detailPattern: /Greeter#salutation/,
      responseStart,
      workerId: ready.workerId as number,
      source:
        'class Greeter; def salutation; "hi"; end; end\nputs Greeter.new.sal',
      expectedPosition: { line: 1, character: 20 },
    });
    await expectEditorSource(
      page,
      'class Greeter; def salutation; "hi"; end; end\nputs Greeter.new.salutation',
    );
    await expectRubyOutput(page, "hi\n");

    await editRuby(page, "box = Object.new\nputs box");
    responseStart = (await lspObservations(page)).length;
    await page.keyboard.type(".upc", { delay: 50 });
    const unsupportedResponse = await waitForSnapshotResponse(page, {
      responseStart,
      workerId: ready.workerId as number,
      source: "box = Object.new\nputs box.upc",
      position: { line: 1, character: 12 },
    });
    const rawLabels =
      unsupportedResponse.response.candidates?.map(candidateLabel) ?? [];
    expect(rawLabels).not.toContain("upcase");
    await expect(visibleCandidateLabel(page, "upcase")).toHaveCount(0);
    await expectEditorSource(page, "box = Object.new\nputs box.upc");

    await editRuby(page, "box = Object.new\nputs box.class");
    await expectRubyOutput(page, "Object\n");
  });

  test(`TypeProf refreshes inferred candidates after a full editor document update on Ruby ${version}`, async ({
    page,
  }, testInfo) => {
    const startedAt = Date.now();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    let phase = "setup";
    page.on("pageerror", (error) =>
      pageErrors.push(error.stack ?? error.message),
    );
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await watchAnalysisWorkers(page);
    try {
      await page.goto(codeOnlyUrl("", version));
      phase = "initial-ready";
      const ready = await waitForReadyVersion(page, version);

      phase = "first-completion";
      await editRuby(page, 'value = "hello"\nputs value');
      let responseStart = (await lspObservations(page)).length;
      const stringCompletion = await typeAndSelectTypeProfCandidate(page, {
        prefix: ".upc",
        label: "upcase",
        detailPattern: /String#upcase/,
        responseStart,
        workerId: ready.workerId as number,
        source: 'value = "hello"\nputs value.upc',
        expectedPosition: { line: 1, character: 14 },
      });
      await expectEditorSource(page, 'value = "hello"\nputs value.upcase');
      await expectRubyOutput(page, "HELLO\n");

      phase = "full-document-update-and-second-completion";
      await editRuby(page, "value = 42\np value");
      responseStart = (await lspObservations(page)).length;
      const integerCompletion = await typeAndSelectTypeProfCandidate(page, {
        prefix: ".di",
        label: "digits",
        detailPattern: /Integer#digits/,
        responseStart,
        workerId: ready.workerId as number,
        source: "value = 42\np value.di",
        expectedPosition: { line: 1, character: 10 },
        selection: "keyboard",
      });
      expect(integerCompletion.event.documentVersion).toBeGreaterThan(
        stringCompletion.event.documentVersion ?? -1,
      );
      await expect(
        integerCompletion.event.candidates?.map(candidateLabel),
      ).not.toContain("upcase");
      await expectEditorSource(page, "value = 42\np value.digits");
      await expectRubyOutput(page, "[2, 4]\n");
    } finally {
      const observations = await lspObservations(page).catch((error) => [
        { diagnosticReadFailure: String(error) },
      ]);
      const finalUI = await page
        .evaluate(() => ({
          source: [...document.querySelectorAll(".monaco-editor .view-line")]
            .map((line) => line.textContent ?? "")
            .join("\n"),
          suggestions: [
            ...document.querySelectorAll('[role="listbox"] .monaco-list-row'),
          ].map((row) => ({
            text: row.textContent,
            ariaLabel: row.getAttribute("aria-label"),
          })),
          output: document.querySelector('[data-testid="preview-console"]')
            ?.textContent,
          executionStatus: document.querySelector(
            '[aria-labelledby="output-heading"] [role="status"]',
          )?.textContent,
          completionStatus: document.querySelector(
            '[role="status"][aria-label^="Code completion status:"]',
          )?.textContent,
        }))
        .catch((error) => ({ diagnosticReadFailure: String(error) }));
      const diagnosticPath = testInfo.outputPath(
        "typeprof-refresh-diagnostic.json",
      );
      const serialized = JSON.stringify(
        {
          head: process.env.COMPLETION_UI_HEAD ?? "not-recorded",
          runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
          version,
          startedAt,
          finishedAt: Date.now(),
          phase,
          observations,
          finalUI,
          pageErrors,
          consoleErrors,
        },
        null,
        2,
      );
      try {
        await mkdir(dirname(diagnosticPath), { recursive: true });
        await writeFile(diagnosticPath, serialized, "utf8");
      } catch (error) {
        console.error(
          "Failed to persist TypeProf refresh diagnostic JSON",
          error,
        );
      }
      await testInfo
        .attach("typeprof-refresh-diagnostic.json", {
          path: diagnosticPath,
          contentType: "application/json",
        })
        .catch((error: unknown) => {
          console.error(
            "Failed to attach TypeProf refresh diagnostic JSON",
            error,
          );
        });
    }
  });

  test(`TypeProf preserves a midline suffix through insertion on Ruby ${version}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const expectedBeforeSelection = 'puts "hello".upc + "!"';
    const expectedAfterSelection = 'puts "hello".upcase + "!"';
    const diagnostic: Record<string, unknown> = {
      head: process.env.COMPLETION_UI_HEAD ?? "not-recorded",
      runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
      version,
      startedAt: Date.now(),
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
      await page.goto(codeOnlyUrl("", version));
      const ready = await waitForReadyVersion(page, version);
      diagnostic.ready = ready;

      await editRuby(page, 'puts "hello" + "!"');
      for (let index = 0; index < 6; index += 1)
        await page.keyboard.press("ArrowLeft");
      const responseStart = (await lspObservations(page)).length;
      await page.keyboard.type(".upc", { delay: 50 });
      await expectEditorSource(page, expectedBeforeSelection);

      const currentWorker = ready.workerId;
      let observations: Array<Record<string, unknown>> = [];
      let documentEvents: Array<Record<string, unknown>> = [];
      let finalChange: Record<string, unknown> | undefined;
      let finalRequest: Record<string, unknown> | undefined;
      await expect
        .poll(async () => {
          observations = await lspObservations(page);
          documentEvents = observations
            .slice(responseStart)
            .filter(
              (event) =>
                event.direction === "notification" &&
                event.workerId === currentWorker &&
                (event.method === "textDocument/didOpen" ||
                  event.method === "textDocument/didChange"),
            );
          finalChange = documentEvents.at(-1);
          const changes = finalChange?.contentChanges as
            Array<{ text?: string }> | undefined;
          const openedText = (
            finalChange?.textDocument as { text?: string } | undefined
          )?.text;
          const finalText = changes?.at(-1)?.text ?? openedText;
          finalRequest = observations
            .slice(responseStart)
            .filter(
              (event) =>
                event.direction === "request" &&
                event.workerId === currentWorker &&
                event.method === "textDocument/completion" &&
                event.documentVersion === finalChange?.documentVersion &&
                JSON.stringify(event.position) ===
                  JSON.stringify({ line: 0, character: 16 }),
            )
            .at(-1);
          return finalText === expectedBeforeSelection && !!finalRequest;
        })
        .toBe(true);
      diagnostic.documentEvents = documentEvents;
      diagnostic.finalChange = finalChange;
      expect(finalChange).toBeDefined();
      expect(finalChange?.documentVersion).toBeDefined();
      const contentChanges = finalChange?.contentChanges as
        Array<{ text?: string }> | undefined;
      const openedText = (
        finalChange?.textDocument as { text?: string } | undefined
      )?.text;
      expect(contentChanges?.at(-1)?.text ?? openedText).toBe(
        expectedBeforeSelection,
      );

      const completionRequests = observations
        .slice(responseStart)
        .filter(
          (event) =>
            event.direction === "request" &&
            event.workerId === currentWorker &&
            event.method === "textDocument/completion",
        );
      diagnostic.completionRequests = completionRequests;
      diagnostic.finalRequest = finalRequest;
      expect(finalRequest).toBeDefined();
      expect(finalRequest?.documentVersion).toBe(finalChange?.documentVersion);
      expect(finalRequest?.position).toEqual({ line: 0, character: 16 });

      await expect
        .poll(async () => {
          const current = await lspObservations(page);
          return current.some(
            (event) =>
              event.direction === "response" &&
              event.workerId === finalRequest?.workerId &&
              event.token === finalRequest?.token &&
              event.method === "textDocument/completion",
          );
        })
        .toBe(true);
      const response = (await lspObservations(page)).find(
        (event) =>
          event.direction === "response" &&
          event.workerId === finalRequest?.workerId &&
          event.token === finalRequest?.token &&
          event.method === "textDocument/completion",
      ) as CompletionResponse | undefined;
      diagnostic.finalResponse = response;
      const upcaseItem = response?.candidates?.find(
        (candidate) => candidateLabel(candidate) === "upcase",
      );
      expect(upcaseItem).toBeDefined();
      expect(upcaseItem?.textEdit).toEqual({
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 16 },
        },
        newText: "upcase",
      });

      const upcase = visibleCandidateLabel(page, "upcase");
      await expect(upcase).toHaveCount(1);
      await upcase.click();
      await expectEditorSource(page, expectedAfterSelection);
      diagnostic.selectedSource = expectedAfterSelection;
      await expectRubyOutput(page, "HELLO!\n");
      diagnostic.output = await page
        .getByTestId("preview-console")
        .textContent();
      diagnostic.result = "passed";
      await page.screenshot({ path: testInfo.outputPath("midline-hello.png") });
    } catch (error) {
      diagnostic.failure =
        error instanceof Error ? error.message : String(error);
      diagnostic.failureStack =
        error instanceof Error ? error.stack : undefined;
      throw error;
    } finally {
      diagnostic.finishedAt = Date.now();
      diagnostic.observations = await lspObservations(page).catch((error) =>
        String(error),
      );
      diagnostic.finalEditor = await page
        .evaluate(() => ({
          source: [...document.querySelectorAll(".monaco-editor .view-line")]
            .map((line) => (line.textContent ?? "").replace(/\u00a0/g, " "))
            .join("\n"),
          status: document.querySelector(
            '[role="status"][aria-label^="Code completion status:"]',
          )?.textContent,
          output: document.querySelector('[data-testid="preview-console"]')
            ?.textContent,
          suggestionRows: [
            ...document.querySelectorAll(".suggest-widget .monaco-list-row"),
          ].map((row) => row.textContent),
        }))
        .catch((error) => String(error));
      await page
        .screenshot({ path: testInfo.outputPath("midline-final.png") })
        .catch((error) => {
          diagnostic.screenshotFailure = String(error);
        });
      const diagnosticPath = testInfo.outputPath("midline-diagnostic.json");
      const serialized = JSON.stringify(diagnostic, null, 2);
      await mkdir(dirname(diagnosticPath), { recursive: true });
      await writeFile(diagnosticPath, serialized, "utf8");
      await testInfo
        .attach("midline-diagnostic.json", {
          path: diagnosticPath,
          contentType: "application/json",
        })
        .catch(() => undefined);
    }
  });

  test(`TypeProf preserves Japanese and emoji UTF-16 positions on Ruby ${version}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const before = '名前 = "😀"; puts 名前.upc + "!"';
    const after = '名前 = "😀"; puts 名前.upcase + "!"';
    const position = { line: 0, character: 22 };
    const diagnostic: Record<string, unknown> = {
      head: process.env.COMPLETION_UI_HEAD ?? "not-recorded",
      runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
      version,
      startedAt: Date.now(),
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
      await page.goto(codeOnlyUrl("", version));
      const ready = await waitForReadyVersion(page, version);
      diagnostic.ready = ready;
      await editRuby(page, '名前 = "😀"; puts 名前 + "!"');
      for (let index = 0; index < 6; index += 1)
        await page.keyboard.press("ArrowLeft");
      const responseStart = (await lspObservations(page)).length;
      await page.keyboard.type(".upc", { delay: 50 });
      await expectEditorSource(page, before);

      const { documentEvent, request, response, item } =
        await waitForSnapshotCandidate(page, {
          responseStart,
          workerId: ready.workerId as number,
          source: before,
          position,
          label: "upcase",
        });
      diagnostic.documentEvent = documentEvent;
      diagnostic.request = request;
      diagnostic.response = response;
      diagnostic.item = item;
      expect(response.documentVersion).toBe(documentEvent.documentVersion);
      expect(item.textEdit).toEqual({
        range: {
          start: { line: 0, character: 19 },
          end: { line: 0, character: 22 },
        },
        newText: "upcase",
      });

      const upcase = visibleCandidateLabel(page, "upcase");
      await expect(upcase).toHaveCount(1);
      await upcase.click();
      await expectEditorSource(page, after);
      diagnostic.selectedSource = after;
      await expectRubyOutput(page, "😀!\n");
      diagnostic.output = await page
        .getByTestId("preview-console")
        .textContent();
      diagnostic.result = "passed";
      await page.screenshot({ path: testInfo.outputPath("emoji-utf16.png") });
    } catch (error) {
      diagnostic.failure =
        error instanceof Error ? error.message : String(error);
      diagnostic.failureStack =
        error instanceof Error ? error.stack : undefined;
      throw error;
    } finally {
      diagnostic.finishedAt = Date.now();
      diagnostic.observations = await lspObservations(page).catch((error) =>
        String(error),
      );
      diagnostic.finalEditor = await page
        .evaluate(() => ({
          source: [...document.querySelectorAll(".monaco-editor .view-line")]
            .map((line) => (line.textContent ?? "").replace(/\u00a0/g, " "))
            .join("\n"),
          completionStatus: document.querySelector(
            '[role="status"][aria-label^="Code completion status:"]',
          )?.textContent,
          output: document.querySelector('[data-testid="preview-console"]')
            ?.textContent,
        }))
        .catch((error) => String(error));
      await page
        .screenshot({ path: testInfo.outputPath("emoji-utf16-final.png") })
        .catch((error) => {
          diagnostic.screenshotFailure = String(error);
        });
      const diagnosticPath = testInfo.outputPath("emoji-utf16-diagnostic.json");
      const serialized = JSON.stringify(diagnostic, null, 2);
      await mkdir(dirname(diagnosticPath), { recursive: true });
      await writeFile(diagnosticPath, serialized, "utf8");
      await testInfo
        .attach("emoji-utf16-diagnostic.json", {
          path: diagnosticPath,
          contentType: "application/json",
        })
        .catch(() => undefined);
    }
  });
}

async function waitForRawCandidate(
  page: Page,
  label: string,
  responseStart: number,
): Promise<{ event: CompletionResponse; item: RawCandidate }> {
  await expect
    .poll(async () => {
      const events = await lspObservations(page);
      return events
        .slice(responseStart)
        .some(
          (event) =>
            event.direction === "response" &&
            event.method === "textDocument/completion" &&
            (event.candidates as RawCandidate[] | undefined)?.some(
              (candidate) => candidateLabel(candidate) === label,
            ),
        );
    })
    .toBe(true);
  const event = (await lspObservations(page))
    .slice(responseStart)
    .filter(
      (entry) =>
        entry.direction === "response" &&
        entry.method === "textDocument/completion" &&
        (entry.candidates as RawCandidate[] | undefined)?.some(
          (candidate) => candidateLabel(candidate) === label,
        ),
    )
    .at(-1) as CompletionResponse | undefined;
  const item = event?.candidates?.find(
    (candidate) => candidateLabel(candidate) === label,
  );
  expect(event).toBeDefined();
  expect(item).toBeDefined();
  return { event: event as CompletionResponse, item: item as RawCandidate };
}

test("TypeProf Fiber#raise detail follows the selected Ruby core in the UI", async ({
  page,
}, testInfo) => {
  await watchAnalysisWorkers(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) =>
    pageErrors.push(error.stack ?? error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(codeOnlyUrl("", "3.3"));
  const startedAt = Date.now();
  let previousWorkerId: number | undefined;
  let readyCount = 0;
  const matrix: Array<Record<string, unknown>> = [];

  try {
    for (const version of ["3.3", "4.0", "3.3"] as const) {
      if (new URL(page.url()).searchParams.get("v") !== version) {
        const priorReady = (await lspObservations(page)).filter(
          (event) => event.direction === "ready",
        );
        readyCount = priorReady.length;
        await page.getByLabel("Ruby version").selectOption(version);
      }
      const ready = await waitForReadyVersion(
        page,
        version,
        readyCount,
        previousWorkerId,
      );
      const workerId = ready.workerId as number;
      const patchVersion = version === "3.3" ? "3.3.3" : "4.0.0";
      await expect(
        page
          .getByRole("region", { name: "Ruby runtime environment" })
          .getByRole("heading", { name: `Ruby ${patchVersion}`, exact: true }),
      ).toBeVisible();
      const record: Record<string, unknown> = {
        version,
        ready,
        workerId,
        readyCountBefore: readyCount,
        sourceBeforeInput: "puts Fiber.new.",
      };
      matrix.push(record);
      await editRuby(page, "puts Fiber.new.");
      const responseStart = (await lspObservations(page)).length;
      record.responseStart = responseStart;
      const { event, item } = await typeAndSelectVersionOnlyForInspection(
        page,
        {
          prefix: "rai",
          label: "raise",
          responseStart,
          expectedWorkerId: workerId,
        },
      );
      expect(item.detail).toMatch(/Fiber#raise/);
      record.request = event;
      record.rawItem = item;
      const row = visibleCandidateLabel(page, "raise");
      await expect(row).toBeVisible();
      await row.hover();
      const widget = page.locator(".suggest-widget");
      const renderedText = await widget.innerText();
      expect(renderedText).toContain("Fiber#raise");
      if (version === "4.0") expect(renderedText).toMatch(/cause:/);
      else expect(renderedText).not.toMatch(/cause:/);
      record.renderedText = renderedText;
      await page.screenshot({
        path: testInfo.outputPath(
          `fiber-typeprof-${version}-${matrix.length}.png`,
        ),
      });
      previousWorkerId = workerId;
    }
  } finally {
    const observations = await lspObservations(page).catch((error) => [
      { diagnosticReadFailure: String(error) },
    ]);
    const finalUI = await page
      .evaluate(() => ({
        source: [...document.querySelectorAll(".monaco-editor .view-line")]
          .map((line) => line.textContent ?? "")
          .join("\n"),
        suggestions: [
          ...document.querySelectorAll('[role="listbox"] .monaco-list-row'),
        ].map((row) => ({
          text: row.textContent,
          ariaLabel: row.getAttribute("aria-label"),
        })),
        output: document.querySelector('[data-testid="preview-console"]')
          ?.textContent,
        executionStatus: document.querySelector(
          '[aria-labelledby="output-heading"] [role="status"]',
        )?.textContent,
      }))
      .catch((error) => ({ diagnosticReadFailure: String(error) }));
    const diagnosticPath = testInfo.outputPath(
      "typeprof-fiber-version-matrix.json",
    );
    const diagnostic = {
      head: process.env.COMPLETION_UI_HEAD ?? "not-recorded",
      runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
      startedAt,
      finishedAt: Date.now(),
      matrix,
      observations,
      finalUI,
      pageErrors,
      consoleErrors,
    };
    const serialized = JSON.stringify(diagnostic, null, 2);
    try {
      await mkdir(dirname(diagnosticPath), { recursive: true });
      await writeFile(diagnosticPath, serialized, "utf8");
    } catch (error) {
      console.error("Failed to persist Fiber diagnostic JSON", error);
    }
    await testInfo
      .attach("typeprof-fiber-version-matrix.json", {
        path: diagnosticPath,
        contentType: "application/json",
      })
      .catch((error: unknown) => {
        console.error("Failed to attach Fiber diagnostic JSON", error);
      });
  }
});

async function typeAndSelectVersionOnlyForInspection(
  page: Page,
  options: {
    prefix: string;
    label: string;
    responseStart: number;
    expectedWorkerId: number;
  },
): Promise<{ event: CompletionResponse; item: RawCandidate }> {
  await page.keyboard.type(options.prefix, { delay: 50 });
  const { event, item } = await waitForRawCandidate(
    page,
    options.label,
    options.responseStart,
  );
  expect(event.workerId).toBe(options.expectedWorkerId);
  expect(item.detail).toBeDefined();
  return { event, item };
}

test("TypeProf ignores an old response after a rapid version switch and OFF", async ({
  page,
}, testInfo) => {
  const startedAt = Date.now();
  const diagnostic: Record<string, unknown> = {
    head: process.env.COMPLETION_UI_HEAD ?? "not-recorded",
    runtime: process.env.COMPLETION_RUNTIME_COMMIT ?? "not-recorded",
    startedAt,
    phase: "setup",
    failure: undefined as string | undefined,
  };
  const saveDiagnostic = async () => {
    const diagnosticPath = testInfo.outputPath(
      "typeprof-lifecycle-diagnostic.json",
    );
    const snapshot = {
      ...diagnostic,
      finishedAt: Date.now(),
      heldResponses: await heldCompletionResponses(page).catch((error) =>
        String(error),
      ),
      clientMessageDeliveries: await page
        .evaluate(
          () =>
            (window as unknown as { __clientMessageDeliveries?: unknown[] })
              .__clientMessageDeliveries ?? [],
        )
        .catch((error) => String(error)),
      observations: await lspObservations(page).catch((error) => String(error)),
      workerUrls: await analysisWorkerUrls(page).catch((error) =>
        String(error),
      ),
      terminations: await analysisWorkerTerminations(page).catch((error) =>
        String(error),
      ),
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
          output: document.querySelector('[data-testid="preview-console"]')
            ?.textContent,
        }))
        .catch((error) => String(error)),
    };
    const serialized = JSON.stringify(snapshot, null, 2);
    await mkdir(dirname(diagnosticPath), { recursive: true });
    await writeFile(diagnosticPath, serialized, "utf8");
    await testInfo
      .attach("typeprof-lifecycle-diagnostic.json", {
        path: diagnosticPath,
        contentType: "application/json",
      })
      .catch(() => undefined);
  };

  await watchAnalysisWorkers(page, {
    holdCompletionResponses: { documentSuffix: ".upc" },
  });
  try {
    diagnostic.phase = "ready-3.3-and-hold-old";
    await page.goto(codeOnlyUrl("", "3.3"));
    const ready33 = await waitForReadyVersion(page, "3.3");

    const oldResponseStart = (await lspObservations(page)).length;
    await editRuby(page, 'puts "old"');
    await page.keyboard.type(".upc", { delay: 40 });
    const held33 = await waitForHeldCompletionForSource(page, {
      responseStart: oldResponseStart,
      workerId: ready33.workerId as number,
      source: 'puts "old".upc',
      position: { line: 0, character: 'puts "old".upc'.length },
    });
    diagnostic.heldOldCompletion = held33;

    diagnostic.phase = "ready-4.0-and-hold-middle";
    const readyBefore40 = (await lspObservations(page)).filter(
      (event) => event.direction === "ready",
    ).length;
    await page.getByLabel("Ruby version").selectOption("4.0");
    const ready40 = await waitForReadyVersion(
      page,
      "4.0",
      readyBefore40,
      ready33.workerId as number,
    );
    const middleResponseStart = (await lspObservations(page)).length;
    await editRuby(page, 'puts "middle"');
    await page.keyboard.type(".upc", { delay: 40 });
    const held40 = await waitForHeldCompletionForSource(page, {
      responseStart: middleResponseStart,
      workerId: ready40.workerId as number,
      source: 'puts "middle".upc',
      position: { line: 0, character: 'puts "middle".upc'.length },
    });
    diagnostic.heldMiddleCompletion = held40;

    diagnostic.phase = "ready-restored-3.3-and-current-response";
    const readyBeforeBack = (await lspObservations(page)).filter(
      (event) => event.direction === "ready",
    ).length;
    await page.getByLabel("Ruby version").selectOption("3.3");
    const readyBack33 = await waitForReadyVersion(
      page,
      "3.3",
      readyBeforeBack,
      ready40.workerId as number,
    );
    const finalResponseStart = (await lspObservations(page)).length;
    await editRuby(page, 'puts "final"');
    const responseStart = (await lspObservations(page)).length;
    await page.keyboard.type(".upc", { delay: 40 });
    const heldFinal = await waitForHeldCompletionForSource(page, {
      responseStart: finalResponseStart,
      workerId: readyBack33.workerId as number,
      source: 'puts "final".upc',
      position: { line: 0, character: 'puts "final".upc'.length },
    });
    expect(
      await releaseHeldCompletionResponse(
        page,
        heldFinal?.workerId as number,
        heldFinal?.token as number,
      ),
    ).toBe(true);
    await expectHeldClientDeliveryProof(
      page,
      heldFinal.workerId,
      heldFinal.token,
      true,
    );
    const { event } = await waitForRawCandidate(page, "upcase", responseStart);
    expect(event.workerId).toBe(readyBack33.workerId);
    const currentRow = visibleCandidateLabel(page, "upcase");
    await expect(currentRow).toBeVisible();
    await selectVisibleCandidateByKeyboard(page, "upcase");
    await expectEditorSource(page, 'puts "final".upcase');
    await expectRubyOutput(page, "FINAL\n");

    diagnostic.phase = "release-stale-responses-after-version-switch";
    const staleResponses = (await heldCompletionResponses(page)).filter(
      (held) =>
        !(
          held.workerId === heldFinal.workerId && held.token === heldFinal.token
        ),
    );
    for (const stale of staleResponses) {
      expect(stale.documentText).toMatch(/\.upc$/);
      expect(
        await releaseHeldCompletionResponse(
          page,
          stale?.workerId as number,
          stale?.token as number,
        ),
      ).toBe(true);
      await expectHeldClientDeliveryProof(
        page,
        stale.workerId,
        stale.token,
        true,
      );
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expectEditorSource(page, 'puts "final".upcase');
    await expectRubyOutput(page, "FINAL\n");
    await expect(page.getByRole("listbox", { name: "Suggest" })).toHaveCount(0);

    diagnostic.phase = "OFF-disposal";
    await page.locator('label[for="completion-enabled"]').click();
    await expect(page.getByText("Off", { exact: true })).toBeVisible();
    await expect
      .poll(async () => analysisWorkerTerminations(page))
      .not.toHaveLength(0);
    await editRuby(page, 'puts "OFF still permits Ruby execution"');
    await expectRubyOutput(page, "OFF still permits Ruby execution\n");
    expect(await analysisWorkerUrls(page)).toHaveLength(3);
    diagnostic.phase = "passed";
  } catch (error) {
    diagnostic.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await saveDiagnostic().catch((error) => {
      console.error("Failed to persist TypeProf lifecycle diagnostic", error);
    });
  }
});
