import { afterEach, describe, expect, it, vi } from "vitest";
import { CompletionClient } from "./client";

class WorkerBridge extends EventTarget {
  terminated = false;
  terminateCalls = 0;
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
    this.terminateCalls += 1;
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
      expect({
        unhandled,
        statuses,
        terminated: workerBridge.terminated,
        terminateCalls: workerBridge.terminateCalls,
      }).toEqual({
        unhandled: [],
        statuses: ["error"],
        terminated: true,
        terminateCalls: 1,
      });
    } finally {
      process.off("unhandledRejection", onUnhandled);
      client?.dispose();
    }
  });

  it.each([
    ["corrupt gzip", "download", "gzip", "gzip decompression rejected"],
    [
      "matching-length hash mismatch",
      "download",
      "hash",
      "Ruby completion asset hash did not match its manifest.",
    ],
    [
      "asset size mismatch",
      "download",
      "size",
      "Ruby completion asset size did not match its manifest.",
    ],
    ["WASM compile rejection", "compile", "compile", "compile rejected"],
    [
      "Ruby VM initialization rejection",
      "TypeProf initialization",
      "initialize",
      "VM rejected",
    ],
  ])("reports %s once at the expected stage without an unhandled rejection", async (_name, expectedStage, failure, expectedError) => {
    const workerMessages: unknown[] = [];
    const workerScope = {
      location: { origin: "http://127.0.0.1" },
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage(message: unknown) {
        workerMessages.push(message);
      },
    };
    const bytesByPath = new Map<string, Uint8Array>();
    const files = [
      "typeprof-analysis.wasm",
      "analysis_server.rb",
      "versioned/adapter.rb",
      "versioned/core-4.0.json",
    ];
    for (const [index, path] of files.entries()) {
      const content = new TextEncoder().encode(
        path.endsWith(".json") ? JSON.stringify({ "core.rb": "module Core; end" }) : `asset-${index}`,
      );
      bytesByPath.set(path, content);
    }
    const wasmPath = "typeprof-analysis.wasm";
    bytesByPath.set(
      wasmPath,
      failure === "gzip"
        ? new Uint8Array([0x1f, 0x8b, 0, 0])
        : new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    );
    const manifestFiles: Record<string, Record<string, unknown>> = {};
    const compile = vi.fn(async () => ({} as WebAssembly.Module));
    const instantiateModule = vi.fn(async () => {
      if (failure === "initialize") throw new Error("VM rejected");
      return {
        vm: {
          eval: vi.fn(() => ({ call: () => ({ toString: () => "[]" }) })),
        },
      };
    });
    let decompressionCalls = 0;
    for (const [path, bytes] of bytesByPath) {
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      manifestFiles[path] = {
        bytes: failure === "size" && path === wasmPath ? bytes.byteLength + 1 : bytes.byteLength,
        sha256: failure === "hash" && path === wasmPath ? "0".repeat(64) : digest,
      };
    }
    if (failure === "gzip") {
      manifestFiles[wasmPath].gzipBytes = 4;
      manifestFiles[wasmPath].gzipSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytesByPath.get(wasmPath)!))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }
    const fetchAssets = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/manifest.json"))
        return new Response(JSON.stringify({ files: manifestFiles }), { status: 200 });
      const path = url.pathname.split("/lsp/")[1].replace(/\.gz$/, "");
      return new Response(bytesByPath.get(path), { status: 200 });
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    vi.stubGlobal("self", workerScope);
    vi.stubGlobal("fetch", fetchAssets);
    if (failure === "compile")
      compile.mockRejectedValue(new Error("compile rejected"));
    vi.stubGlobal("WebAssembly", { ...WebAssembly, compile });
    if (failure === "gzip") {
      vi.stubGlobal(
        "DecompressionStream",
        class {
          constructor(readonly format: string) {}
        },
      );
      vi.stubGlobal(
        "Blob",
        class {
          constructor(parts: unknown[]) {
            expect(parts).toHaveLength(1);
          }
          stream() {
            return {
              pipeThrough: (transform: { format: string }) => {
                expect(transform.format).toBe("gzip");
                decompressionCalls += 1;
                throw new Error("gzip decompression rejected");
              },
            };
          }
        },
      );
    }
    vi.doMock("@ruby/wasm-wasi", () => ({
      RubyVM: { instantiateModule },
    }));
    vi.doMock("@bjorn3/browser_wasi_shim", () => ({
      ConsoleStdout: class {}, Directory: class {}, File: class {}, Inode: class {},
      OpenFile: class {}, PreopenDirectory: class {}, WASI: class {},
    }));
    await import("./worker");
    process.on("unhandledRejection", onUnhandled);
    try {
      workerScope.onmessage!(new MessageEvent("message", { data: { type: "initialize", target: "4.0" } }));
      for (let turn = 0; turn < 20 && workerMessages.length === 0; turn++)
        await new Promise<void>((resolve) => setImmediate(resolve));
      expect(workerMessages).toEqual([
        { type: "fatal", stage: expectedStage, error: expectedError },
      ]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect({
        unhandled,
        fatalCount: workerMessages.length,
        compileCalls: compile.mock.calls.length,
        instantiateCalls: instantiateModule.mock.calls.length,
        decompressionCalls,
      }).toEqual({
        unhandled: [],
        fatalCount: 1,
        compileCalls: failure === "compile" || failure === "initialize" ? 1 : 0,
        instantiateCalls: failure === "initialize" ? 1 : 0,
        decompressionCalls: failure === "gzip" ? 1 : 0,
      });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
