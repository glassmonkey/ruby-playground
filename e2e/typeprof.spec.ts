import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { editRuby, expectEditorSource, expectRubyOutput } from "./editor";
import {
  analysisWorkerTerminations,
  analysisWorkerUrls,
  heldCompletionResponses,
  lspObservations,
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

type TypeInferenceCase = {
  name: string;
  codeBeforePrefix: string;
  prefix: string;
  cursorLeft?: number;
  label: string;
  detailPattern?: RegExp;
  codeAfterSelection: string;
  output: string;
};

const versions = ["3.3", "4.0"] as const;

const typeInferenceCases: TypeInferenceCase[] = [
  {
    name: "method return type",
    codeBeforePrefix: 'def greeting; "hello"; end\nputs greeting',
    prefix: ".upc",
    label: "upcase",
    detailPattern: /String#upcase/,
    codeAfterSelection: 'def greeting; "hello"; end\nputs greeting.upcase',
    output: "HELLO\n",
  },
  {
    name: "Array#first element type",
    codeBeforePrefix: 'words = ["hello", "world"]\nputs words.first',
    prefix: ".upc",
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
    expectedPosition,
    onTyped,
  }: {
    prefix: string;
    label: string;
    detailPattern?: RegExp;
    responseStart: number;
    expectedPosition?: Position;
    onTyped?: () => Promise<void>;
  },
): Promise<{ event: CompletionResponse; item: RawCandidate }> {
  await page.keyboard.type(prefix, { delay: 50 });
  await onTyped?.();
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

  const events = await lspObservations(page);
  const event = events
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
  expect(event).toBeDefined();
  const item = event?.candidates?.find(
    (candidate) => candidateLabel(candidate) === label,
  );
  expect(item).toBeDefined();
  if (detailPattern) expect(item?.detail).toMatch(detailPattern);
  expect(event?.workerId).toBeDefined();
  expect(event?.documentVersion).toBeDefined();
  if (expectedPosition) expect(event?.position).toEqual(expectedPosition);

  // The accessible row name can include TypeProf documentation details. Match
  // the exact visible label node so `upcase` cannot select `upcase!`.
  const candidateName = visibleCandidateLabel(page, label);
  await expect(candidateName).toHaveCount(1, { timeout: 30_000 });
  await expect(candidateName).toBeVisible();
  await candidateName.click();
  return { event: event as CompletionResponse, item: item as RawCandidate };
}

for (const version of versions) {
  for (const inferenceCase of typeInferenceCases) {
    test(`TypeProf ${inferenceCase.name} completion inserts and executes on Ruby ${version}`, async ({
      page,
    }, testInfo) => {
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
        await page.goto(`./?v=${version}`);
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
    await page.goto(`./?v=${version}`);
    await waitForReadyVersion(page, version);

    await editRuby(page, 'greeting = "hi"\nputs ');
    let responseStart = (await lspObservations(page)).length;
    await typeAndSelectTypeProfCandidate(page, {
      prefix: "gree",
      label: "greeting",
      responseStart,
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
    });
    await expectEditorSource(
      page,
      'class Greeter; def salutation; "hi"; end; end\nputs Greeter.new.salutation',
    );
    await expectRubyOutput(page, "hi\n");

    await editRuby(page, "box = Object.new\nputs box");
    responseStart = (await lspObservations(page)).length;
    await page.keyboard.type(".upc", { delay: 50 });
    await expect
      .poll(async () => {
        const responses = (await lspObservations(page))
          .slice(responseStart)
          .filter(
            (event) =>
              event.direction === "response" &&
              event.method === "textDocument/completion",
          );
        return responses.at(-1)?.position;
      })
      .toEqual({ line: 1, character: 12 });
    const lastResponse = (await lspObservations(page))
      .slice(responseStart)
      .filter(
        (event) =>
          event.direction === "response" &&
          event.method === "textDocument/completion",
      )
      .at(-1);
    const rawLabels =
      (lastResponse?.candidates as RawCandidate[] | undefined)?.map(
        candidateLabel,
      ) ?? [];
    expect(rawLabels).not.toContain("upcase");
    await expect(visibleCandidateLabel(page, "upcase")).toHaveCount(0);
    await expectEditorSource(page, "box = Object.new\nputs box.upc");

    await editRuby(page, "box = Object.new\nputs box.class");
    await expectRubyOutput(page, "Object\n");
  });

  test(`TypeProf refreshes inferred candidates after a full editor document update on Ruby ${version}`, async ({
    page,
  }) => {
    await watchAnalysisWorkers(page);
    await page.goto(`./?v=${version}`);
    await waitForReadyVersion(page, version);

    await editRuby(page, 'value = "hello"\nputs value');
    let responseStart = (await lspObservations(page)).length;
    const stringCompletion = await typeAndSelectTypeProfCandidate(page, {
      prefix: ".upc",
      label: "upcase",
      detailPattern: /String#upcase/,
      responseStart,
    });
    await expectEditorSource(page, 'value = "hello"\nputs value.upcase');
    await expectRubyOutput(page, "HELLO\n");

    await editRuby(page, "value = 42\np value");
    responseStart = (await lspObservations(page)).length;
    const integerCompletion = await typeAndSelectTypeProfCandidate(page, {
      prefix: ".di",
      label: "digits",
      detailPattern: /Integer#digits/,
      responseStart,
    });
    expect(integerCompletion.event.documentVersion).toBeGreaterThan(
      stringCompletion.event.documentVersion ?? -1,
    );
    await expect(
      integerCompletion.event.candidates?.map(candidateLabel),
    ).not.toContain("upcase");
    await expectEditorSource(page, "value = 42\np value.digits");
    await expectRubyOutput(page, "[2, 4]\n");
  });

  test(`TypeProf preserves a midline suffix and emoji-aware UTF-16 text edit on Ruby ${version}`, async ({
    page,
  }, testInfo) => {
    await watchAnalysisWorkers(page);
    await page.goto(`./?v=${version}`);
    await waitForReadyVersion(page, version);

    await editRuby(page, 'puts "hello" + "!"');
    for (let index = 0; index < 6; index += 1)
      await page.keyboard.press("ArrowLeft");
    let responseStart = (await lspObservations(page)).length;
    await page.keyboard.type(".upc", { delay: 50 });
    await expectEditorSource(page, 'puts "hello".upc + "!"');
    await expect
      .poll(async () =>
        (await lspObservations(page))
          .slice(responseStart)
          .some(
            (event) =>
              event.direction === "response" &&
              event.method === "textDocument/completion" &&
              (event.candidates as RawCandidate[] | undefined)?.some(
                (candidate) => candidateLabel(candidate) === "upcase",
              ),
          ),
      )
      .toBe(true);
    const midlineResponse = (await lspObservations(page))
      .slice(responseStart)
      .filter(
        (event) =>
          event.direction === "response" &&
          event.method === "textDocument/completion" &&
          (event.candidates as RawCandidate[] | undefined)?.some(
            (candidate) => candidateLabel(candidate) === "upcase",
          ),
      )
      .at(-1) as CompletionResponse | undefined;
    expect(midlineResponse?.position).toEqual({ line: 0, character: 16 });
    expect(
      midlineResponse?.candidates?.find(
        (candidate) => candidateLabel(candidate) === "upcase",
      )?.textEdit,
    ).toEqual({
      range: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 16 },
      },
      newText: "upcase",
    });
    const midlineRow = visibleCandidateLabel(page, "upcase");
    await expect(midlineRow).toBeVisible();
    await midlineRow.click();
    await expectEditorSource(page, 'puts "hello".upcase + "!"');
    await expectRubyOutput(page, "HELLO!\n");

    await editRuby(page, '名前 = "😀"; puts 名前 + "!"');
    for (let index = 0; index < 6; index += 1)
      await page.keyboard.press("ArrowLeft");
    responseStart = (await lspObservations(page)).length;
    await page.keyboard.type(".upc", { delay: 50 });
    await expectEditorSource(page, '名前 = "😀"; puts 名前.upc + "!"');
    const { event, item } = await waitForRawCandidate(
      page,
      "upcase",
      responseStart,
    );
    // Monaco requests at the `.` trigger (UTF-16 offset 19), then filters the
    // typed `upc` locally; the returned textEdit must still replace 19..22.
    expect(event.position).toEqual({ line: 0, character: 19 });
    expect(item.textEdit).toEqual({
      range: {
        start: { line: 0, character: 19 },
        end: { line: 0, character: 22 },
      },
      newText: "upcase",
    });
    const unicodeRow = visibleCandidateLabel(page, "upcase");
    await expect(unicodeRow).toBeVisible();
    await unicodeRow.click();
    await expectEditorSource(page, '名前 = "😀"; puts 名前.upcase + "!"');
    await expectRubyOutput(page, "😀!\n");
    await page.screenshot({ path: testInfo.outputPath("typeprof-utf16.png") });
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
  await page.goto("./?v=3.3");
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
        sourceBeforeInput: "Fiber.new { :ok }",
      };
      matrix.push(record);
      await editRuby(page, "Fiber.new { :ok }");
      const responseStart = (await lspObservations(page)).length;
      record.responseStart = responseStart;
      const { event, item } = await typeAndSelectVersionOnlyForInspection(
        page,
        {
          prefix: ".rai",
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
}) => {
  await watchAnalysisWorkers(page, { holdCompletionResponses: true });
  await page.goto("./?v=3.3");
  const ready33 = await waitForReadyVersion(page, "3.3");

  await editRuby(page, 'puts "old"');
  await page.keyboard.type(".upc", { delay: 40 });
  await expect.poll(async () => heldCompletionResponses(page)).toHaveLength(1);
  const [held33] = await heldCompletionResponses(page);
  expect(held33).toBeDefined();

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
  await editRuby(page, 'puts "middle"');
  await page.keyboard.type(".upc", { delay: 40 });
  await expect.poll(async () => heldCompletionResponses(page)).toHaveLength(2);
  const held40 = (await heldCompletionResponses(page)).find(
    (response) => response.workerId === ready40.workerId,
  );
  expect(held40).toBeDefined();

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
  await editRuby(page, 'puts "final"');
  const responseStart = (await lspObservations(page)).length;
  await page.keyboard.type(".upc", { delay: 40 });
  await expect.poll(async () => heldCompletionResponses(page)).toHaveLength(3);
  const heldFinal = (await heldCompletionResponses(page)).find(
    (response) => response.workerId === readyBack33.workerId,
  );
  expect(heldFinal).toBeDefined();
  expect(
    await releaseHeldCompletionResponse(
      page,
      heldFinal?.workerId as number,
      heldFinal?.token as number,
    ),
  ).toBe(true);
  const { event } = await waitForRawCandidate(page, "upcase", responseStart);
  expect(event.workerId).toBe(readyBack33.workerId);
  const currentRow = page
    .getByRole("listbox", { name: "Suggest" })
    .getByRole("listitem", { name: /^upcase(?:,|$)/ });
  await expect(currentRow).toBeVisible();
  await currentRow.click();
  await expectEditorSource(page, 'puts "final".upcase');
  await expectRubyOutput(page, "FINAL\n");

  for (const stale of [held33, held40]) {
    expect(stale).toBeDefined();
    expect(
      await releaseHeldCompletionResponse(
        page,
        stale?.workerId as number,
        stale?.token as number,
      ),
    ).toBe(true);
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await expectEditorSource(page, 'puts "final".upcase');
  await expectRubyOutput(page, "FINAL\n");
  await expect(page.getByRole("listbox", { name: "Suggest" })).toHaveCount(0);

  await page.locator('label[for="completion-enabled"]').click();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await expect
    .poll(async () => analysisWorkerTerminations(page))
    .not.toHaveLength(0);
  await editRuby(page, 'puts "OFF still permits Ruby execution"');
  await expectRubyOutput(page, "OFF still permits Ruby execution\n");
  expect(await analysisWorkerUrls(page)).toHaveLength(3);
});
