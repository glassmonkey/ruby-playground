import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type {
  CancellationToken,
  Position,
  editor,
  languages,
} from "monaco-editor";
import RubyEditor from "./editor";

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
    if (message.method === "textDocument/completion") return [rawCompletion];
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
  return {
    uri: { toString: () => "inmemory://model/unmount" },
    isDisposed: () => false,
    getValue: () => "x.",
    getVersionId: () => 1,
    getLineContent: () => "x.",
    getLineMaxColumn: () => 3,
    getWordUntilPosition: () => ({ startColumn: 2, endColumn: 3 }),
  };
}

function createTestContext() {
  const model = makeModel();
  const statuses: string[] = [];
  const providerDispose = vi.fn();
  harness.provider = undefined;
  harness.editorInstance = {
    getModel: () => model as unknown as editor.ITextModel,
    getPosition: () => ({ lineNumber: 1, column: 3 }),
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
  };
}

describe("RubyEditor unmount cleanup", () => {
  beforeEach(() => {
    harness.workerInstances = [];
    harness.registerCompletionItemProvider.mockReset();
    FakeAnalysisWorker.holdMethods = new Set();
    vi.stubGlobal("Worker", FakeAnalysisWorker);
  });

  afterEach(() => {
    cleanup();
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

  it("returns the original candidate and does not apply delayed resolve details after unmount", async () => {
    // Arrange
    FakeAnalysisWorker.holdMethods = new Set(["completionItem/resolve"]);
    const sut = createTestContext();
    await waitFor(() => expect(harness.provider).toBeDefined());
    act(() => sut.worker.announceReady());
    const completion = (await harness.provider!.provideCompletionItems!(
      sut.model as unknown as editor.ITextModel,
      { lineNumber: 1, column: 3 } as Position,
      { triggerKind: 1 },
      { isCancellationRequested: false } as CancellationToken,
    ))!;
    const candidate = completion.suggestions[0];

    // Act
    const pending = harness.provider!.resolveCompletionItem!(candidate, {
      isCancellationRequested: false,
    } as CancellationToken);
    await waitFor(() =>
      expect(
        sut.worker.messages.some(
          ({ message }) => message.method === "completionItem/resolve",
        ),
      ).toBe(true),
    );
    const request = sut.worker.messages.find(
      ({ message }) => message.method === "completionItem/resolve",
    )!;
    sut.view.unmount();
    const got = await pending;
    sut.worker.reply(request, {
      ...rawCompletion,
      documentation: { kind: "markdown", value: "late detail" },
    });

    // Assert
    expect(got).toBe(candidate);
    expect({
      candidate: {
        label: candidate.label,
        kind: candidate.kind,
        detail: candidate.detail,
        documentation: candidate.documentation,
        insertText: candidate.insertText,
      },
      terminateCalls: sut.worker.terminate.mock.calls.length,
      providerDisposeCalls: sut.providerDispose.mock.calls.length,
      analysisWorkers: harness.workerInstances.length,
      providerLanguages: harness.registerCompletionItemProvider.mock.calls.map(
        ([language]) => language,
      ),
      statuses: sut.statuses,
      workerMethods: sut.worker.messages.map(({ message }) => message.method),
      workerInitialization: sut.worker.postMessages[0],
      resolveParams: request.message.params,
    }).toEqual({
      candidate: {
        label: "raise",
        kind: 1,
        detail: undefined,
        documentation: undefined,
        insertText: "raise",
      },
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
        "completionItem/resolve",
      ],
      resolveParams: {
        ...rawCompletion,
      },
    });
  });
});
