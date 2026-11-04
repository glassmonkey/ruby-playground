import { afterEach, describe, expect, it, vi } from "vitest";
import { CompletionClient } from "./client";

class WorkerBridge extends EventTarget {
  terminated = false;
  onWorkerMessage?: (event: MessageEvent<unknown>) => void;

  postMessage(message: unknown): void {
    this.onWorkerMessage?.(new MessageEvent("message", { data: message }));
  }

  postFromWorker(message: unknown): void {
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("LSP worker startup failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@ruby/wasm-wasi");
    vi.doUnmock("@bjorn3/browser_wasi_shim");
    vi.resetModules();
  });

  it("reports a malformed manifest as a client error without an unhandled rejection", async () => {
    const workerBridge = new WorkerBridge();
    const workerMessages: unknown[] = [];
    const workerScope = {
      location: { origin: "http://127.0.0.1" },
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage(message: unknown) {
        workerMessages.push(message);
        workerBridge.postFromWorker(message);
      },
    };
    const unhandled: unknown[] = [];
    const statuses: Array<"ready" | "error"> = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    const fetchManifest = vi.fn(async () =>
      new Response("<!doctype html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    vi.stubGlobal("self", workerScope);
    vi.stubGlobal("fetch", fetchManifest);
    vi.doMock("@ruby/wasm-wasi", () => ({ RubyVM: {} }));
    vi.doMock("@bjorn3/browser_wasi_shim", () => ({
      ConsoleStdout: class {},
      Directory: class {},
      File: class {},
      Inode: class {},
      OpenFile: class {},
      PreopenDirectory: class {},
      WASI: class {},
    }));
    await import("./worker");
    workerBridge.onWorkerMessage = (event) => workerScope.onmessage?.(event);

    // Vitest worker modules install their handler on the scope at import time.
    // Re-deliver initialize through that public Worker entrypoint.
    let client: CompletionClient | undefined;
    process.on("unhandledRejection", onUnhandled);
    try {
      client = new CompletionClient(
        workerBridge as unknown as Worker,
        (status) => statuses.push(status),
        100,
        "4.0",
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fetchManifest).toHaveBeenCalledWith(
        new URL("/lsp/manifest.json", "http://127.0.0.1"),
        { cache: "no-cache" },
      );
      expect(workerMessages).toEqual([
        { type: "fatal", stage: "download", error: expect.any(String) },
      ]);
      await expect(
        client.complete("file:///main.rb", "puts 1", 1, {
          line: 0,
          character: 6,
        }),
      ).rejects.toThrow();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect({ unhandled, statuses, terminated: workerBridge.terminated }).toEqual({
        unhandled: [],
        statuses: ["error"],
        terminated: true,
      });
    } finally {
      process.off("unhandledRejection", onUnhandled);
      client?.dispose();
    }
  });
});
