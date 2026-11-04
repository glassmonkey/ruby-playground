import type { LspRubyVersion } from "./versions";

export type CompletionPosition = { line: number; character: number };
export type LspCompletionItem = {
  label: string | { label: string };
  [key: string]: unknown;
};
type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};
type WorkerResponse = {
  type: "response";
  token: number;
  responses?: JsonRpcMessage[];
  error?: string;
};
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export const LSP_REQUEST_TIMEOUT_MS = 8_000;
export const LSP_BOOT_TIMEOUT_MS = 60_000;

/** Owns one analysis worker and serializes the single-document LSP session. */
export class CompletionClient {
  private readonly pending = new Map<number, Pending>();
  private readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private nextToken = 0;
  private nextRequestId = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private bootTimer: ReturnType<typeof setTimeout>;
  private initialized = false;
  private documentVersion = 0;
  private documentUri?: string;
  private disposed = false;
  private failed?: Error;

  constructor(
    private readonly worker: Worker,
    private readonly onStatus: (status: "ready" | "error") => void,
    private readonly timeoutMs = LSP_REQUEST_TIMEOUT_MS,
    target: LspRubyVersion,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // Keep boot failures safe when no completion request is awaiting ready yet.
    // Awaiters still observe the original rejection and receive the failure.
    void this.ready.catch(() => undefined);
    this.bootTimer = setTimeout(
      () => this.fail(new Error("Ruby completion initialization timed out.")),
      LSP_BOOT_TIMEOUT_MS,
    );
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleError);
    worker.postMessage({ type: "initialize", target });
    worker.addEventListener("messageerror", this.handleMessageError);
  }

  complete(
    uri: string,
    text: string,
    version: number,
    position: CompletionPosition,
  ): Promise<LspCompletionItem[]> {
    const operation = this.queue.then(async () => {
      await this.ready;
      this.assertUsable();
      if (!this.initialized) {
        await this.sendRequest("initialize", {
          processId: null,
          rootUri: "file:///playground",
          capabilities: { general: { positionEncodings: ["utf-16"] } },
          initializationOptions: {
            enabledFeatures: ["completion"],
            formatter: "none",
            linters: [],
          },
        });
        await this.sendNotification("initialized", {});
        this.initialized = true;
      }

      if (this.documentUri !== uri) {
        if (this.documentUri)
          await this.sendNotification("textDocument/didClose", {
            textDocument: { uri: this.documentUri },
          });
        await this.sendNotification("textDocument/didOpen", {
          textDocument: { uri, languageId: "ruby", version, text },
        });
        this.documentUri = uri;
        this.documentVersion = version;
      } else if (version > this.documentVersion) {
        await this.sendNotification("textDocument/didChange", {
          textDocument: { uri, version },
          contentChanges: [{ text }],
        });
        this.documentVersion = version;
      }

      const result = await this.sendRequest("textDocument/completion", {
        textDocument: { uri },
        position,
      });
      if (Array.isArray(result)) return result as LspCompletionItem[];
      if (
        typeof result === "object" &&
        result !== null &&
        Array.isArray((result as { items?: unknown }).items)
      )
        return (result as { items: LspCompletionItem[] }).items;
      return [];
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.bootTimer);
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError);
    this.worker.removeEventListener("messageerror", this.handleMessageError);
    this.worker.terminate();
    const error = new Error("Ruby completion worker was disposed.");
    this.readyReject(error);
    this.rejectPending(error);
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const value = event.data as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return;
    if (value.type === "ready") {
      clearTimeout(this.bootTimer);
      this.readyResolve();
      this.onStatus("ready");
      return;
    }
    if (value.type === "fatal") {
      this.fail(new Error(String(value.error ?? "Ruby completion failed.")));
      return;
    }
    if (value.type !== "response" || typeof value.token !== "number") return;
    const response = value as unknown as WorkerResponse;
    const pending = this.pending.get(response.token);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.token);
    if (response.error) {
      const error = new Error(response.error);
      pending.reject(error);
      this.fail(error);
      return;
    }
    const rpc = response.responses?.find((entry) => "id" in entry);
    if (rpc?.error) {
      const error = new Error(rpc.error.message ?? "LSP request failed.");
      pending.reject(error);
      this.fail(error);
    } else pending.resolve(rpc?.result);
  };

  private readonly handleError = (): void =>
    this.fail(new Error("Ruby completion worker failed."));

  private readonly handleMessageError = (): void =>
    this.fail(new Error("Could not read the Ruby completion response."));

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextRequestId;
    return this.send({ jsonrpc: "2.0", id, method, params }).then((result) => {
      if (method === "initialize") this.initialized = false;
      return result;
    });
  }

  private sendNotification(method: string, params: unknown): Promise<void> {
    return this.send({ jsonrpc: "2.0", method, params }).then(() => undefined);
  }

  private send(message: JsonRpcMessage): Promise<unknown> {
    this.assertUsable();
    const token = ++this.nextToken;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(token);
        const error = new Error("Ruby completion request timed out.");
        reject(error);
        this.fail(error);
      }, this.timeoutMs);
      this.pending.set(token, { resolve, reject, timer });
      this.worker.postMessage({ type: "request", token, message });
    });
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Ruby completion worker was disposed.");
    if (this.failed) throw this.failed;
  }

  private fail(error: Error): void {
    if (this.disposed || this.failed) return;
    this.failed = error;
    clearTimeout(this.bootTimer);
    this.readyReject(error);
    this.rejectPending(error);
    this.onStatus("error");
    this.worker.terminate();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export type { LspRubyVersion };
