import type { Page } from "@playwright/test";

export type ObservedCompletionItem = {
  label?: string | { label?: string };
  kind?: number;
  detail?: string;
  documentation?: string | { value?: string };
  textEdit?: unknown;
  data?: unknown;
  labelDetails?: unknown;
  insertText?: string;
};

type CompletionDiagnosticWindow = Window & {
  __analysisWorkerUrls?: string[];
  __lspObservations?: Array<Record<string, unknown>>;
  __lspTerminationEvents?: Array<{
    url: string;
    workerId?: number;
    at: number;
  }>;
  __holdCompletionResponses?: boolean;
  __heldCompletionResponses?: Array<{
    workerId: number;
    token: number;
    method: string;
    heldAt: number;
    response: unknown;
  }>;
  __releaseHeldCompletionResponse?: (
    workerId: number,
    token: number,
  ) => boolean;
};

export async function watchAnalysisWorkers(
  page: Page,
  options: { holdCompletionResponses?: boolean } = {},
): Promise<void> {
  await page.addInitScript((holdCompletionResponses) => {
    const diagnosticWindow = window as unknown as CompletionDiagnosticWindow;
    const urls: string[] = [];
    const observations: Array<Record<string, unknown>> = [];
    const terminationEvents = JSON.parse(
      sessionStorage.getItem("completion-worker-terminations") ?? "[]",
    ) as Array<{ url: string; workerId?: number; at: number }>;
    diagnosticWindow.__analysisWorkerUrls = urls;
    diagnosticWindow.__lspObservations = observations;
    diagnosticWindow.__lspTerminationEvents = terminationEvents;
    diagnosticWindow.__holdCompletionResponses = holdCompletionResponses;
    diagnosticWindow.__heldCompletionResponses = [];
    const heldDeliveryCallbacks: Array<{
      workerId: number;
      token: number;
      deliver: () => void;
    }> = [];
    diagnosticWindow.__releaseHeldCompletionResponse = (workerId, token) => {
      const index = heldDeliveryCallbacks.findIndex(
        (entry) => entry.workerId === workerId && entry.token === token,
      );
      if (index < 0) return false;
      const [held] = heldDeliveryCallbacks.splice(index, 1);
      held.deliver();
      return true;
    };
    const NativeWorker = window.Worker;
    let nextAnalysisWorkerId = 0;
    const InstrumentedWorker = function (
      url: string | URL,
      options?: WorkerOptions,
    ) {
      const resolvedUrl = new URL(url, window.location.href);
      if (/\/worker-[^/]+\.js$/.test(resolvedUrl.pathname)) {
        const workerId = ++nextAnalysisWorkerId;
        urls.push(resolvedUrl.pathname);
        const worker = new NativeWorker(url, options);
        const pending = new Map<
          number,
          {
            method: string;
            startedAt: number;
            documentVersion?: number;
            position?: unknown;
            data?: unknown;
            item?: unknown;
          }
        >();
        const nativePostMessage = worker.postMessage.bind(worker);
        const nativeTerminate = worker.terminate.bind(worker);
        const nativeAddEventListener = worker.addEventListener.bind(worker);
        const nativeRemoveEventListener =
          worker.removeEventListener.bind(worker);
        const messageListenerWrappers = new Map<
          EventListenerOrEventListenerObject,
          EventListener
        >();
        let messageListenerRegistration = 0;
        let observedDocumentVersion: number | undefined;
        worker.terminate = (() => {
          terminationEvents.push({
            url: resolvedUrl.pathname,
            workerId,
            at: performance.now(),
          });
          sessionStorage.setItem(
            "completion-worker-terminations",
            JSON.stringify(terminationEvents),
          );
          nativeTerminate();
        }) as typeof worker.terminate;
        worker.addEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          listenerOptions?: boolean | AddEventListenerOptions,
        ) => {
          if (!listener) return;
          if (type !== "message") {
            nativeAddEventListener(type, listener, listenerOptions);
            return;
          }
          const isClientMessageListener = messageListenerRegistration++ === 0;
          const wrappedListener: EventListener = (event) => {
            const messageEvent = event as MessageEvent<{
              type?: string;
              token?: number;
            }>;
            const response = messageEvent.data;
            const request =
              typeof response.token === "number"
                ? pending.get(response.token)
                : undefined;
            if (
              isClientMessageListener &&
              diagnosticWindow.__holdCompletionResponses &&
              response.type === "response" &&
              request?.method === "textDocument/completion" &&
              typeof response.token === "number"
            ) {
              diagnosticWindow.__heldCompletionResponses?.push({
                workerId,
                token: response.token,
                method: request.method,
                heldAt: performance.now(),
                response: response as unknown,
              });
              heldDeliveryCallbacks.push({
                workerId,
                token: response.token,
                deliver: () => {
                  if (typeof listener === "function")
                    listener.call(
                      worker,
                      new MessageEvent("message", { data: response }),
                    );
                  else
                    listener.handleEvent(
                      new MessageEvent("message", { data: response }),
                    );
                },
              });
              return;
            }
            if (typeof listener === "function") listener.call(worker, event);
            else listener.handleEvent(event);
          };
          messageListenerWrappers.set(listener, wrappedListener);
          nativeAddEventListener(type, wrappedListener, listenerOptions);
        }) as typeof worker.addEventListener;
        worker.removeEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          listenerOptions?: boolean | EventListenerOptions,
        ) => {
          if (!listener) return;
          const wrapped = messageListenerWrappers.get(listener);
          if (type === "message" && wrapped) {
            messageListenerWrappers.delete(listener);
            nativeRemoveEventListener(type, wrapped, listenerOptions);
            return;
          }
          nativeRemoveEventListener(type, listener, listenerOptions);
        }) as typeof worker.removeEventListener;
        worker.postMessage = ((message: unknown, transfer?: Transferable[]) => {
          const request = message as {
            type?: string;
            target?: string;
            token?: number;
            message?: {
              method?: string;
              params?: unknown;
            };
          };
          if (request.type === "initialize") {
            observations.push({
              direction: "initialize",
              workerId,
              target: request.target,
              workerUrl: resolvedUrl.pathname,
              at: performance.now(),
            });
          } else if (
            request.type === "request" &&
            typeof request.token === "number"
          ) {
            const method = request.message?.method ?? "unknown";
            const startedAt = performance.now();
            const params = request.message?.params as
              | {
                  textDocument?: { version?: number };
                  position?: unknown;
                  data?: unknown;
                }
              | undefined;
            const messageVersion = params?.textDocument?.version;
            if (typeof messageVersion === "number")
              observedDocumentVersion = messageVersion;
            pending.set(request.token, {
              method,
              startedAt,
              documentVersion: messageVersion ?? observedDocumentVersion,
              position: params?.position,
              data: params?.data,
              item:
                method === "completionItem/resolve"
                  ? request.message?.params
                  : undefined,
            });
            observations.push({
              direction: "request",
              workerId,
              token: request.token,
              method,
              documentVersion: messageVersion ?? observedDocumentVersion,
              position: params?.position,
              data: params?.data,
              item:
                method === "completionItem/resolve"
                  ? request.message?.params
                  : undefined,
              at: startedAt,
            });
          }
          if (transfer) nativePostMessage(message, transfer);
          else nativePostMessage(message);
        }) as typeof worker.postMessage;
        worker.addEventListener("message", (event: MessageEvent<unknown>) => {
          const response = event.data as {
            type?: string;
            version?: string;
            wasmSha256?: string;
            timings?: unknown;
            token?: number;
            elapsedMs?: number;
            responses?: Array<{
              id?: number;
              result?: unknown;
              error?: unknown;
            }>;
            error?: string;
          };
          if (response.type === "ready" || response.type === "fatal") {
            observations.push({
              direction: response.type,
              workerId,
              workerUrl: resolvedUrl.pathname,
              version: response.version,
              wasmSha256: response.wasmSha256,
              timings: response.timings,
              error: response.error,
            });
            return;
          }
          if (
            response.type !== "response" ||
            typeof response.token !== "number"
          )
            return;
          const request = pending.get(response.token);
          if (!request) return;
          pending.delete(response.token);
          const rpc = response.responses?.find((entry) => "id" in entry);
          const result = rpc?.result as
            | ObservedCompletionItem
            | {
                items?: ObservedCompletionItem[];
                signatures?: Array<{ label?: string }>;
              }
            | ObservedCompletionItem[]
            | undefined;
          const rawItems: ObservedCompletionItem[] = Array.isArray(result)
            ? result
            : result && "items" in result && Array.isArray(result.items)
              ? result.items
              : result && "label" in result
                ? [result as ObservedCompletionItem]
                : [];
          observations.push({
            direction: "response",
            token: response.token,
            workerId,
            method: request.method,
            documentVersion: request.documentVersion,
            position: request.position,
            data: request.data,
            item: request.item,
            at: performance.now(),
            responseMs: performance.now() - request.startedAt,
            workerElapsedMs: response.elapsedMs,
            candidateCount: rawItems.length,
            candidates: rawItems.map((item) => ({
              label:
                typeof item.label === "string" ? item.label : item.label?.label,
              kind: item.kind,
              detail: item.detail,
              documentation:
                typeof item.documentation === "string"
                  ? item.documentation
                  : item.documentation?.value,
              textEdit: item.textEdit,
              data: item.data,
              labelDetails: item.labelDetails,
              insertText: item.insertText,
            })),
            signatures:
              result &&
              !Array.isArray(result) &&
              "signatures" in result &&
              Array.isArray(result.signatures)
                ? result.signatures.map((signature) => signature.label)
                : undefined,
          });
        });
        return worker;
      }
      return new NativeWorker(url, options);
    } as unknown as typeof Worker;
    InstrumentedWorker.prototype = NativeWorker.prototype;
    window.Worker = InstrumentedWorker;
  }, options.holdCompletionResponses ?? false);
}

export async function heldCompletionResponses(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as CompletionDiagnosticWindow)
        .__heldCompletionResponses ?? [],
  );
}

export async function releaseHeldCompletionResponse(
  page: Page,
  workerId: number,
  token: number,
) {
  return page.evaluate(
    ({ workerId: targetWorkerId, token: targetToken }) =>
      (
        window as unknown as CompletionDiagnosticWindow
      ).__releaseHeldCompletionResponse?.(targetWorkerId, targetToken) ?? false,
    { workerId, token },
  );
}

export async function analysisWorkerUrls(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as CompletionDiagnosticWindow).__analysisWorkerUrls ??
      [],
  );
}

export async function lspObservations(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    () =>
      (window as unknown as CompletionDiagnosticWindow).__lspObservations ?? [],
  );
}

export async function analysisWorkerTerminations(
  page: Page,
): Promise<Array<{ url: string; at: number }>> {
  return page.evaluate(
    () =>
      (window as unknown as CompletionDiagnosticWindow)
        .__lspTerminationEvents ?? [],
  );
}

export function latestRawCompletion(events: Array<Record<string, unknown>>) {
  const event = events
    .filter(
      (entry) =>
        entry.direction === "response" &&
        entry.method === "textDocument/completion",
    )
    .at(-1);
  return event
    ? (event.candidates as Array<{
        label?: string;
        kind?: number;
        detail?: string;
        textEdit?: unknown;
      }>)
    : [];
}
