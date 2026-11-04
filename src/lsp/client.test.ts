import { afterEach, describe, expect, it, vi } from "vitest";
import { CompletionClient } from "./client";

class FakeWorker extends EventTarget {
  messages: unknown[] = [];
  terminated = false;
  respond = true;
  responseError?: string;

  postMessage(value: unknown): void {
    const workerMessage = value as { type?: string };
    if (workerMessage.type === "initialize") return;
    this.messages.push(value);
    if (!this.respond) return;
    queueMicrotask(() => {
      const request = value as {
        token: number;
        message: { id?: number; method: string };
      };
      const responses = this.responseError
        ? []
        :
        request.message.id === undefined
          ? []
          : [
              {
                jsonrpc: "2.0",
                id: request.message.id,
                result:
                  request.message.method === "textDocument/completion"
                    ? [{ label: "upcase" }]
                    : {},
              },
            ];
      this.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "response",
            token: request.token,
            responses,
            error: this.responseError,
          },
        }),
      );
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

function createClient(
  worker: FakeWorker,
  timeout = 100,
  statuses: Array<"ready" | "error"> = [],
): CompletionClient {
  return new CompletionClient(
    worker as unknown as Worker,
    (status) => statuses.push(status),
    timeout,
    "4.0",
  );
}

function start(
  worker: FakeWorker,
  timeout = 100,
  statuses: Array<"ready" | "error"> = [],
): CompletionClient {
  const client = createClient(worker, timeout, statuses);
  worker.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }));
  return client;
}

function watchUnhandledRejections() {
  const reasons: unknown[] = [];
  const listener = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", listener);
  return {
    async expectNoneAfterNextMacrotask(): Promise<void> {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(reasons).toEqual([]);
    },
    stop(): void {
      process.off("unhandledRejection", listener);
    },
  };
}

describe("CompletionClient", () => {
  afterEach(() => vi.useRealTimers());

  it("initializes one LSP session and sends open/change/completion in order", async () => {
    const worker = new FakeWorker();
    const statuses: Array<"ready" | "error"> = [];
    const sut = start(worker, 100, statuses);
    try {
      const first = await sut.complete("file:///main.rb", "\"hi\".up", 1, {
        line: 0,
        character: 8,
      });
      const second = await sut.complete(
        "file:///main.rb",
        "\"hello\".up",
        2,
        { line: 0, character: 10 },
      );
      const got = {
        first,
        second,
        methods: worker.messages.map(
          (entry) =>
            (entry as { message: { method: string } }).message.method,
        ),
      };
      const want = {
        first: [{ label: "upcase" }],
        second: [{ label: "upcase" }],
        methods: [
          "initialize",
          "initialized",
          "textDocument/didOpen",
          "textDocument/completion",
          "textDocument/didChange",
          "textDocument/completion",
        ],
      };
      expect({ got, statuses }).toEqual({
        got: want,
        statuses: ["ready"],
      });
    } finally {
      sut.dispose();
    }
  });

  it("reports an LSP failure and terminates the unusable analysis worker", async () => {
    const worker = new FakeWorker();
    worker.responseError = "server initialization failed";
    const statuses: Array<"ready" | "error"> = [];
    const sut = start(worker, 100, statuses);
    try {
      const got = await sut
        .complete("file:///main.rb", "1", 1, { line: 0, character: 1 })
        .then(
          () => "resolved",
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        );
      expect({ got, statuses, terminated: worker.terminated }).toEqual({
        got: "server initialization failed",
        statuses: ["ready", "error"],
        terminated: true,
      });
    } finally {
      sut.dispose();
    }
  });

  it("rejects and terminates on an LSP request timeout", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    worker.respond = false;
    const sut = start(worker, 5);
    const result = sut.complete("file:///main.rb", "1", 1, {
      line: 0,
      character: 1,
    });
    await vi.advanceTimersByTimeAsync(6);
    try {
      await expect(result).rejects.toThrow("timed out");
      expect(worker.terminated).toBe(true);
    } finally {
      sut.dispose();
    }
  });

  it("handles a pre-request fatal worker message and rejects later completion", async () => {
    const unhandled = watchUnhandledRejections();
    const worker = new FakeWorker();
    const sut = createClient(worker);
    try {
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "fatal", error: "asset download failed" },
        }),
      );
      await unhandled.expectNoneAfterNextMacrotask();
      await expect(
        sut.complete("file:///main.rb", "1", 1, { line: 0, character: 1 }),
      ).rejects.toThrow("asset download failed");
      expect(worker.terminated).toBe(true);
    } finally {
      sut.dispose();
      unhandled.stop();
    }
  });

  it("handles a boot timeout before the first request and rejects later completion", async () => {
    vi.useFakeTimers();
    const unhandled = watchUnhandledRejections();
    const worker = new FakeWorker();
    const sut = createClient(worker);
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      vi.useRealTimers();
      await unhandled.expectNoneAfterNextMacrotask();
      await expect(
        sut.complete("file:///main.rb", "1", 1, { line: 0, character: 1 }),
      ).rejects.toThrow("initialization timed out");
      expect(worker.terminated).toBe(true);
    } finally {
      sut.dispose();
      unhandled.stop();
    }
  });

  it("handles disposal before the first request and rejects later completion", async () => {
    const unhandled = watchUnhandledRejections();
    const worker = new FakeWorker();
    const sut = createClient(worker);
    try {
      sut.dispose();
      await unhandled.expectNoneAfterNextMacrotask();
      await expect(
        sut.complete("file:///main.rb", "1", 1, { line: 0, character: 1 }),
      ).rejects.toThrow("disposed");
      expect(worker.terminated).toBe(true);
    } finally {
      unhandled.stop();
    }
  });

  it("ignores a late disposed session when completion starts again after re-enable", async () => {
    const oldWorker = new FakeWorker();
    oldWorker.respond = false;
    const oldClient = start(oldWorker);
    const pending = oldClient.complete("file:///main.rb", "1", 1, {
      line: 0,
      character: 1,
    });
    oldClient.dispose();
    await expect(pending).rejects.toThrow("disposed");

    const newWorker = new FakeWorker();
    const newClient = start(newWorker);
    try {
      const result = await newClient.complete(
        "file:///main.rb",
        "\"hello\".upc",
        1,
        { line: 0, character: 10 },
      );
      oldWorker.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "ready" },
        }),
      );
      expect({ result, oldTerminated: oldWorker.terminated }).toEqual({
        result: [{ label: "upcase" }],
        oldTerminated: true,
      });
    } finally {
      newClient.dispose();
    }
  });

  it("ignores late replies after disposal", async () => {
    const worker = new FakeWorker();
    worker.respond = false;
    const sut = start(worker);
    const result = sut.complete("file:///main.rb", "1", 1, {
      line: 0,
      character: 1,
    });
    sut.dispose();
    await expect(result).rejects.toThrow("disposed");
    worker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "response", token: 1, responses: [{ id: 1, result: [] }] },
      }),
    );
    expect(worker.terminated).toBe(true);
  });
});
