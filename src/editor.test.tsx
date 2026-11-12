import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type {
  CancellationToken,
  Position,
  editor,
  languages,
} from "monaco-editor";
import RubyEditor from "./editor";
import {
  COMPLETION_SNAPSHOT_BUDGET_MS,
  COMPLETION_SNAPSHOT_SETTLE_MS,
} from "./lsp/completion-request";

const harness = vi.hoisted(() => ({
  provider: undefined as languages.CompletionItemProvider | undefined,
  editorInstance: undefined as unknown,
  workerInstances: [] as unknown[],
  registerCompletionItemProvider: vi.fn(),
}));

vi.mock("@chakra-ui/react", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  return {
    default: function MonacoEditorBoundary(props: {
      onMount: (instance: unknown) => void;
    }) {
      const onMount = React.useRef(props.onMount);
      React.useEffect(() => {
        onMount.current(harness.editorInstance);
      }, []);
      return React.createElement("div", { "data-testid": "monaco-boundary" });
    },
    loader: { config: vi.fn() },
  };
});

vi.mock("monaco-editor/editor/editor.api.js", () => ({
  languages: {
    CompletionItemKind: {
      Text: 0,
      Method: 1,
      Function: 2,
      Constructor: 3,
      Field: 4,
      Variable: 5,
      Class: 6,
      Interface: 7,
      Module: 8,
      Property: 9,
      Unit: 10,
      Value: 11,
      Enum: 12,
      Keyword: 13,
      Snippet: 14,
      Color: 15,
      File: 16,
      Reference: 17,
    },
    registerCompletionItemProvider: harness.registerCompletionItemProvider,
  },
  Range: class Range {
    constructor(
      readonly startLineNumber: number,
      readonly startColumn: number,
      readonly endLineNumber: number,
      readonly endColumn: number,
    ) {}
  },
}));

vi.mock("monaco-editor/languages/definitions/ruby/register.js", () => ({}));
vi.mock(
  "monaco-editor/editor/contrib/suggest/browser/suggestController.js",
  () => ({}),
);
vi.mock("monaco-editor/editor/editor.worker?worker", () => ({
  default: class EditorWorkerStub {},
}));

class FakeAnalysisWorker extends EventTarget {
  static holdMethods = new Set<string>();
  static completionItems: unknown[] = [];
  readonly postMessages: unknown[] = [];
  readonly messages: Array<{
    token: number;
    message: { id?: number; method: string; params?: unknown };
  }> = [];
  readonly terminate = vi.fn();

  constructor() {
    super();
    harness.workerInstances.push(this);
  }

  postMessage(value: unknown): void {
    this.postMessages.push(value);
    const envelope = value as {
      type: string;
      token?: number;
      message?: { id?: number; method: string; params?: unknown };
    };
    if (envelope.type !== "request" || !envelope.message || !envelope.token)
      return;
    const request = { token: envelope.token, message: envelope.message };
    this.messages.push(request);
    if (FakeAnalysisWorker.holdMethods.has(request.message.method)) return;
    queueMicrotask(() =>
      this.reply(request, this.responseFor(request.message)),
    );
  }

  reply(
    request: FakeAnalysisWorker["messages"][number],
    result: unknown,
  ): void {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "response",
          token: request.token,
          responses:
            request.message.id === undefined
              ? []
              : [
                  {
                    jsonrpc: "2.0",
                    id: request.message.id,
                    result,
                  },
                ],
        },
      }),
    );
  }

  announceReady(): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: { type: "ready" } }),
    );
  }

  private responseFor(
    message: FakeAnalysisWorker["messages"][number]["message"],
  ): unknown {
    if (message.method === "initialize")
      return {
        capabilities: { completionProvider: { resolveProvider: false } },
      };
    if (message.method === "textDocument/completion")
      return FakeAnalysisWorker.completionItems;
    if (message.method === "completionItem/resolve")
      return {
        ...(message.params as object),
        documentation: { kind: "markdown", value: "Fiber#raise detail" },
      };
    return {};
  }
}

const rawCompletion = {
  label: "raise",
  kind: 2,
  textEdit: {
    range: {
      start: { line: 0, character: 1 },
      end: { line: 0, character: 1 },
    },
    newText: "raise",
  },
  data: { owner_name: "Fiber", guessed_type: false },
};

function makeModel() {
  let text = "x.";
  let version = 1;
  return {
    uri: { toString: () => "inmemory://model/unmount" },
    isDisposed: () => false,
    getValue: () => text,
    getVersionId: () => version,
    getLineContent: () => text,
    getLineMaxColumn: () => text.length + 1,
    getWordUntilPosition: () => ({ startColumn: 2, endColumn: 3 }),
    setSnapshot: (nextText: string, nextVersion: number) => {
      text = nextText;
      version = nextVersion;
    },
  };
}

function createTestContext() {
  const model = makeModel();
  const statuses: string[] = [];
  const providerDispose = vi.fn();
  let position: { lineNumber: number; column: number } = {
    lineNumber: 1,
    column: 3,
  };
  harness.provider = undefined;
  harness.editorInstance = {
    getModel: () => model as unknown as editor.ITextModel,
    getPosition: () => position,
  };
  harness.registerCompletionItemProvider.mockImplementation(
    (_language: string, provider: languages.CompletionItemProvider) => {
      harness.provider = provider;
      return { dispose: providerDispose };
    },
  );
  const onCompletionStatusChange = vi.fn(
    (status: "disabled" | "loading" | "ready" | "unsupported" | "error") => {
      statuses.push(status);
    },
  );
  const view = render(
    <RubyEditor
      code="x."
      version="4.0"
      completionEnabled={true}
      onChange={vi.fn()}
      onCompletionStatusChange={onCompletionStatusChange}
    />,
  );
  const worker = harness.workerInstances.at(-1) as FakeAnalysisWorker;
  return {
    view,
    model,
    worker,
    statuses,
    providerDispose,
    setPosition: (nextPosition: { lineNumber: number; column: number }) => {
      position = nextPosition;
    },
  };
}

describe("RubyEditor unmount cleanup", () => {
  beforeEach(() => {
    harness.workerInstances = [];
    harness.registerCompletionItemProvider.mockReset();
    FakeAnalysisWorker.holdMethods = new Set();
    FakeAnalysisWorker.completionItems = [rawCompletion];
    vi.stubGlobal("Worker", FakeAnalysisWorker);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("terminates its analysis worker and disposes its Monaco provider when completion is pending", async () => {
    // Arrange
    FakeAnalysisWorker.holdMethods = new Set(["textDocument/completion"]);
    const sut = createTestContext();
    await waitFor(() => expect(harness.provider).toBeDefined());
    act(() => sut.worker.announceReady());

    // Act
    const pending = harness.provider!.provideCompletionItems!(
      sut.model as unknown as editor.ITextModel,
      { lineNumber: 1, column: 3 } as Position,
      { triggerKind: 1 },
      { isCancellationRequested: false } as CancellationToken,
    );
    await waitFor(() =>
      expect(
        sut.worker.messages.some(
          ({ message }) => message.method === "textDocument/completion",
        ),
      ).toBe(true),
    );
    const request = sut.worker.messages.find(
      ({ message }) => message.method === "textDocument/completion",
    )!;
    sut.view.unmount();
    const got = await pending;
    sut.worker.reply(request, [rawCompletion]);

    // Assert
    expect({
      got,
      terminateCalls: sut.worker.terminate.mock.calls.length,
      providerDisposeCalls: sut.providerDispose.mock.calls.length,
      analysisWorkers: harness.workerInstances.length,
      providerLanguages: harness.registerCompletionItemProvider.mock.calls.map(
        ([language]) => language,
      ),
      statuses: sut.statuses,
      workerMethods: sut.worker.messages.map(({ message }) => message.method),
      workerInitialization: sut.worker.postMessages[0],
      completionParams: request.message.params,
    }).toEqual({
      got: { suggestions: [] },
      terminateCalls: 1,
      providerDisposeCalls: 1,
      analysisWorkers: 1,
      providerLanguages: ["ruby"],
      statuses: ["loading", "ready"],
      workerInitialization: { type: "initialize", target: "4.0" },
      workerMethods: [
        "initialize",
        "initialized",
        "textDocument/didOpen",
        "textDocument/completion",
      ],
      completionParams: {
        textDocument: { uri: "inmemory://model/unmount" },
        position: { line: 0, character: 2 },
      },
    });
  });

  it("coalesces rapid edits and returns the stopped input after multiple stale responses", async () => {
    // Arrange
    FakeAnalysisWorker.holdMethods = new Set(["textDocument/completion"]);
    const sut = createTestContext();
    sut.model.setSnapshot('puts "hello".', 15);
    sut.setPosition({ lineNumber: 1, column: 14 });
    await waitFor(() => expect(harness.provider).toBeDefined());
    act(() => sut.worker.announceReady());
    const pending = harness.provider!.provideCompletionItems!(
      sut.model as unknown as editor.ITextModel,
      { lineNumber: 1, column: 14 } as Position,
      { triggerKind: 1 },
      { isCancellationRequested: false } as CancellationToken,
    );
    const nextCompletionRequest = async (count: number) => {
      await waitFor(() =>
        expect(
          sut.worker.messages.filter(
            ({ message }) => message.method === "textDocument/completion",
          ),
        ).toHaveLength(count),
      );
      return sut.worker.messages.filter(
        ({ message }) => message.method === "textDocument/completion",
      )[count - 1];
    };
    const first = await nextCompletionRequest(1);

    // Act
    sut.model.setSnapshot('puts "hello".up', 16);
    sut.model.setSnapshot('puts "hello".upc', 17);
    sut.setPosition({ lineNumber: 1, column: 17 });
    sut.worker.reply(first, [{ ...rawCompletion, label: "stale-v15" }]);
    const second = await nextCompletionRequest(2);
    sut.model.setSnapshot('puts "hello".upca', 18);
    sut.setPosition({ lineNumber: 1, column: 18 });
    sut.worker.reply(second, [{ ...rawCompletion, label: "stale-v17" }]);
    const third = await nextCompletionRequest(3);
    sut.model.setSnapshot('puts "hello".upcas', 19);
    sut.setPosition({ lineNumber: 1, column: 19 });
    sut.worker.reply(third, [{ ...rawCompletion, label: "stale-v18" }]);
    const fourth = await nextCompletionRequest(4);
    sut.worker.reply(fourth, [
      {
        ...rawCompletion,
        label: "upcase",
        textEdit: {
          range: {
            start: { line: 0, character: 13 },
            end: { line: 0, character: 18 },
          },
          newText: "upcase",
        },
      },
    ]);
    const got = await pending;

    // Assert
    expect(got?.suggestions).toHaveLength(1);
    const candidate = got!.suggestions[0] as languages.CompletionItem & {
      rubyLspItem: unknown;
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
    };
    expect({
      label: candidate.label,
      kind: candidate.kind,
      detail: candidate.detail,
      documentation: candidate.documentation,
      sortText: candidate.sortText,
      filterText: candidate.filterText,
      insertText: candidate.insertText,
      range: {
        startLineNumber: candidate.range.startLineNumber,
        startColumn: candidate.range.startColumn,
        endLineNumber: candidate.range.endLineNumber,
        endColumn: candidate.range.endColumn,
      },
      rubyLspItem: candidate.rubyLspItem,
    }).toEqual({
      label: "upcase",
      kind: 1,
      detail: undefined,
      documentation: undefined,
      sortText: undefined,
      filterText: undefined,
      insertText: "upcase",
      range: {
        startLineNumber: 1,
        startColumn: 14,
        endLineNumber: 1,
        endColumn: 14,
      },
      rubyLspItem: {
        label: "upcase",
        kind: 2,
        textEdit: {
          range: {
            start: { line: 0, character: 13 },
            end: { line: 0, character: 18 },
          },
          newText: "upcase",
        },
        data: { owner_name: "Fiber", guessed_type: false },
      },
    });
    expect(
      [first, second, third, fourth].map(({ message }) => message.params),
    ).toEqual([
      {
        textDocument: { uri: "inmemory://model/unmount" },
        position: { line: 0, character: 13 },
      },
      {
        textDocument: { uri: "inmemory://model/unmount" },
        position: { line: 0, character: 16 },
      },
      {
        textDocument: { uri: "inmemory://model/unmount" },
        position: { line: 0, character: 17 },
      },
      {
        textDocument: { uri: "inmemory://model/unmount" },
        position: { line: 0, character: 18 },
      },
    ]);
    expect(
      sut.worker.messages
        .filter(({ message }) => message.method === "textDocument/didChange")
        .map(({ message }) => message.params),
    ).toEqual([
      {
        textDocument: { uri: "inmemory://model/unmount", version: 17 },
        contentChanges: [{ text: 'puts "hello".upc' }],
      },
      {
        textDocument: { uri: "inmemory://model/unmount", version: 18 },
        contentChanges: [{ text: 'puts "hello".upca' }],
      },
      {
        textDocument: { uri: "inmemory://model/unmount", version: 19 },
        contentChanges: [{ text: 'puts "hello".upcas' }],
      },
    ]);
    expect(
      sut.worker.messages.filter(
        ({ message }) => message.method === "textDocument/completion",
      ),
    ).toHaveLength(4);
  });

  it("returns no stale result when the overall completion budget expires", async () => {
    // Arrange
    FakeAnalysisWorker.holdMethods = new Set(["textDocument/completion"]);
    const sut = createTestContext();
    sut.model.setSnapshot('puts "hello".', 15);
    sut.setPosition({ lineNumber: 1, column: 14 });
    await waitFor(() => expect(harness.provider).toBeDefined());
    act(() => sut.worker.announceReady());
    vi.useFakeTimers();
    const pending = harness.provider!.provideCompletionItems!(
      sut.model as unknown as editor.ITextModel,
      { lineNumber: 1, column: 14 } as Position,
      { triggerKind: 1 },
      { isCancellationRequested: false } as CancellationToken,
    );
    await act(async () => {
      for (let turn = 0; turn < 40; turn++) await Promise.resolve();
    });
    const first = sut.worker.messages.find(
      ({ message }) => message.method === "textDocument/completion",
    )!;

    // Act
    await vi.advanceTimersByTimeAsync(COMPLETION_SNAPSHOT_BUDGET_MS / 2);
    sut.model.setSnapshot('puts "hello".upc', 18);
    sut.setPosition({ lineNumber: 1, column: 17 });
    sut.worker.reply(first, [{ ...rawCompletion, label: "stale-v15" }]);
    await vi.advanceTimersByTimeAsync(COMPLETION_SNAPSHOT_SETTLE_MS);
    await act(async () => {
      for (let turn = 0; turn < 40; turn++) await Promise.resolve();
    });
    const requests = sut.worker.messages.filter(
      ({ message }) => message.method === "textDocument/completion",
    );
    await vi.advanceTimersByTimeAsync(
      COMPLETION_SNAPSHOT_BUDGET_MS / 2 - COMPLETION_SNAPSHOT_SETTLE_MS,
    );
    const got = await pending;
    sut.worker.reply(requests[1], [rawCompletion]);
    await act(async () => {
      for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    });

    // Assert
    expect(got).toEqual({ suggestions: [] });
    expect(requests.map(({ message }) => message.params)).toEqual([
      {
        textDocument: { uri: "inmemory://model/unmount" },
        position: { line: 0, character: 13 },
      },
      {
        textDocument: { uri: "inmemory://model/unmount" },
        position: { line: 0, character: 16 },
      },
    ]);
    expect(
      sut.worker.messages.filter(
        ({ message }) => message.method === "textDocument/completion",
      ),
    ).toHaveLength(2);
    expect(sut.statuses).toEqual(["loading", "ready"]);
  });

  it("does not issue a newer request after the Monaco cancellation token is cancelled", async () => {
    // Arrange
    FakeAnalysisWorker.holdMethods = new Set(["textDocument/completion"]);
    const sut = createTestContext();
    await waitFor(() => expect(harness.provider).toBeDefined());
    act(() => sut.worker.announceReady());
    const token = { isCancellationRequested: false };
    const pending = harness.provider!.provideCompletionItems!(
      sut.model as unknown as editor.ITextModel,
      { lineNumber: 1, column: 3 } as Position,
      { triggerKind: 1 },
      token as CancellationToken,
    );
    await waitFor(() =>
      expect(
        sut.worker.messages.filter(
          ({ message }) => message.method === "textDocument/completion",
        ),
      ).toHaveLength(1),
    );
    const request = sut.worker.messages.find(
      ({ message }) => message.method === "textDocument/completion",
    )!;

    // Act
    sut.model.setSnapshot("x.up", 2);
    token.isCancellationRequested = true;
    sut.worker.reply(request, [rawCompletion]);
    const got = await pending;

    // Assert
    expect(got).toEqual({ suggestions: [] });
    expect(
      sut.worker.messages.filter(
        ({ message }) => message.method === "textDocument/completion",
      ),
    ).toHaveLength(1);
  });

  it("keeps TypeProf completion details and skips unsupported resolve after unmount", async () => {
    // Arrange
    const sut = createTestContext();
    await waitFor(() => expect(harness.provider).toBeDefined());
    act(() => sut.worker.announceReady());
    const item = {
      ...rawCompletion,
      detail: "Fiber#raise : (?string msg, ?cause: Exception?) -> untyped",
    };
    FakeAnalysisWorker.completionItems = [item];
    const completion = (await harness.provider!.provideCompletionItems!(
      sut.model as unknown as editor.ITextModel,
      { lineNumber: 1, column: 3 } as Position,
      { triggerKind: 1 },
      { isCancellationRequested: false } as CancellationToken,
    ))!;
    const candidate = completion.suggestions[0];

    // Act
    const resolved = await harness.provider!.resolveCompletionItem!(candidate, {
      isCancellationRequested: false,
    } as CancellationToken);
    sut.view.unmount();

    // Assert
    expect({
      candidate: {
        label: candidate.label,
        kind: candidate.kind,
        detail: candidate.detail,
        documentation: candidate.documentation,
        insertText: candidate.insertText,
      },
      resolvedDetail: resolved?.detail,
      terminateCalls: sut.worker.terminate.mock.calls.length,
      providerDisposeCalls: sut.providerDispose.mock.calls.length,
      analysisWorkers: harness.workerInstances.length,
      providerLanguages: harness.registerCompletionItemProvider.mock.calls.map(
        ([language]) => language,
      ),
      statuses: sut.statuses,
      workerMethods: sut.worker.messages.map(({ message }) => message.method),
      workerInitialization: sut.worker.postMessages[0],
    }).toEqual({
      candidate: {
        label: "raise",
        kind: 1,
        detail: "Fiber#raise : (?string msg, ?cause: Exception?) -> untyped",
        documentation: undefined,
        insertText: "raise",
      },
      resolvedDetail:
        "Fiber#raise : (?string msg, ?cause: Exception?) -> untyped",
      terminateCalls: 1,
      providerDisposeCalls: 1,
      analysisWorkers: 1,
      providerLanguages: ["ruby"],
      statuses: ["loading", "ready"],
      workerInitialization: { type: "initialize", target: "4.0" },
      workerMethods: [
        "initialize",
        "initialized",
        "textDocument/didOpen",
        "textDocument/completion",
      ],
    });
  });

  it("maps a TypeProf UTF-16 edit against the original emoji snapshot and preserves its suffix", async () => {
    // Arrange
    const sut = createTestContext();
    const source = 'marker = "😀"; puts "hi".upc + "!"';
    sut.model.setSnapshot(source, 2);
    const end = source.indexOf(".upc") + 4;
    const dotStart = source.indexOf(".upc") + 1;
    sut.setPosition({ lineNumber: 1, column: end + 1 });
    FakeAnalysisWorker.completionItems = [
      {
        label: "upcase",
        kind: 2,
        detail: "String#upcase : () -> String",
        textEdit: {
          range: {
            start: { line: 0, character: dotStart },
            end: { line: 0, character: end },
          },
          newText: "upcase",
        },
      },
    ];
    await waitFor(() => expect(harness.provider).toBeDefined());
    act(() => sut.worker.announceReady());

    // Act
    const result = await harness.provider!.provideCompletionItems!(
      sut.model as unknown as editor.ITextModel,
      { lineNumber: 1, column: end + 1 } as Position,
      { triggerKind: 1 },
      { isCancellationRequested: false } as CancellationToken,
    );
    const candidate = result!.suggestions[0] as languages.CompletionItem & {
      range: { startColumn: number; endColumn: number };
    };
    const inserted =
      source.slice(0, candidate.range.startColumn - 1) +
      String(candidate.insertText) +
      source.slice(candidate.range.endColumn - 1);

    // Assert
    expect({
      label: candidate.label,
      detail: candidate.detail,
      range: candidate.range,
      insertText: candidate.insertText,
      inserted,
    }).toEqual({
      label: "upcase",
      detail: "String#upcase : () -> String",
      range: {
        startLineNumber: 1,
        startColumn: dotStart + 1,
        endLineNumber: 1,
        endColumn: end + 1,
      },
      insertText: "upcase",
      inserted: 'marker = "😀"; puts "hi".upcase + "!"',
    });
    sut.view.unmount();
  });
});
