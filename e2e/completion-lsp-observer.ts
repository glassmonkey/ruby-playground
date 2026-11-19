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
  __holdCompletionResponses?: boolean | { documentSuffix: string };
  __heldCompletionResponses?: Array<{
    workerId: number;
    token: number;
    method: string;
    heldAt: number;
    response: unknown;
    observerMessageListenerCount: number;
    clientMessageListenerCount: number;
    clientDeliveriesBeforeRelease: number;
    documentVersion?: number;
    documentText?: string;
    position?: unknown;
    candidateLabels: string[];
  }>;
  __clientMessageDeliveries?: Array<{
    workerId: number;
    token: number;
    method?: string;
    deliveredAt: number;
    releasedHeldResponse: boolean;
  }>;
  __releaseHeldCompletionResponse?: (
    workerId: number,
    token: number,
  ) => boolean;
};

export function installCompletionWorkerObserver(
  holdCompletionResponses: boolean | { documentSuffix: string } = false,
): void {
  const isCompletionItem = (
    value: unknown,
  ): value is ObservedCompletionItem => {
    if (!value || typeof value !== "object" || !("label" in value))
      return false;
    const label = (value as { label?: unknown }).label;
    return (
      typeof label === "string" ||
      (Boolean(label) &&
        typeof label === "object" &&
        typeof (label as { label?: unknown }).label === "string")
    );
  };
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
  diagnosticWindow.__clientMessageDeliveries = [];
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
          documentText?: string;
          position?: unknown;
          data?: unknown;
          item?: unknown;
        }
      >();
      const requestHistory = new Map<
        number,
        {
          method: string;
          startedAt: number;
          documentVersion?: number;
          documentText?: string;
          position?: unknown;
          data?: unknown;
          item?: unknown;
        }
      >();
      let observedDocumentText: string | undefined;
      const nativePostMessage = worker.postMessage.bind(worker);
      const nativeTerminate = worker.terminate.bind(worker);
      const nativeAddEventListener = worker.addEventListener.bind(worker);
      const nativeRemoveEventListener = worker.removeEventListener.bind(worker);
      const messageListenerWrappers = new Map<
        EventListenerOrEventListenerObject,
        EventListener
      >();
      const helperMessageListeners = new WeakSet<object>();
      const messageListenerRecords: Array<{
        listener: EventListenerOrEventListenerObject;
        wrapper: EventListener;
        helper: boolean;
        active: boolean;
      }> = [];
      const releasedHeldEvents = new WeakSet<Event>();
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
        const isHelperListener = helperMessageListeners.has(listener);
        const wrappedListener: EventListener = (event) => {
          const messageEvent = event as MessageEvent<{
            type?: string;
            token?: number;
            responses?: Array<{ id?: number; result?: unknown }>;
          }>;
          const response = messageEvent.data;
          // The marked observer listener runs before the product listener and
          // consumes `pending`; keep request context separately so holding
          // the client delivery does not depend on that observer deletion.
          const request =
            typeof response.token === "number"
              ? requestHistory.get(response.token)
              : undefined;
          const isReleasedHeldResponse = releasedHeldEvents.has(event);
          if (
            !isHelperListener &&
            type === "message" &&
            response.type === "response" &&
            typeof response.token === "number" &&
            (typeof diagnosticWindow.__holdCompletionResponses === "boolean"
              ? diagnosticWindow.__holdCompletionResponses
              : diagnosticWindow.__holdCompletionResponses?.documentSuffix &&
                request?.documentText?.endsWith(
                  diagnosticWindow.__holdCompletionResponses.documentSuffix,
                )) &&
            !isReleasedHeldResponse &&
            request?.method === "textDocument/completion"
          ) {
            const clientTargets = messageListenerRecords.filter(
              (record) => record.active && !record.helper,
            );
            const observerMessageListenerCount = messageListenerRecords.filter(
              (record) => record.active && record.helper,
            ).length;
            const clientDeliveriesBeforeRelease =
              diagnosticWindow.__clientMessageDeliveries?.filter(
                (delivery) =>
                  delivery.workerId === workerId &&
                  delivery.token === response.token,
              ).length ?? 0;
            const rpc = response.responses?.find(
              (entry) => entry && typeof entry === "object" && "id" in entry,
            );
            const result = rpc?.result;
            const items = Array.isArray(result)
              ? result
              : result &&
                  typeof result === "object" &&
                  Array.isArray((result as { items?: unknown }).items)
                ? (result as { items: unknown[] }).items
                : [];
            const candidateLabels = items.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const label = (item as { label?: unknown }).label;
              if (typeof label === "string") return [label];
              if (
                label &&
                typeof label === "object" &&
                typeof (label as { label?: unknown }).label === "string"
              )
                return [(label as { label: string }).label];
              return [];
            });
            diagnosticWindow.__heldCompletionResponses?.push({
              workerId,
              token: response.token,
              method: request.method,
              heldAt: performance.now(),
              response,
              observerMessageListenerCount,
              clientMessageListenerCount: clientTargets.length,
              clientDeliveriesBeforeRelease,
              documentVersion: request.documentVersion,
              documentText: request.documentText,
              position: request.position,
              candidateLabels,
            });
            // This wrapper is attached to the original product listener, as
            // distinct from the explicitly marked observer listener. Returning
            // here prevents CompletionClient.handleMessage from seeing it.
            event.stopImmediatePropagation();
            heldDeliveryCallbacks.push({
              workerId,
              token: response.token,
              deliver: () => {
                const releasedEvent = new MessageEvent("message", {
                  data: response,
                });
                releasedHeldEvents.add(releasedEvent);
                for (const client of clientTargets)
                  client.wrapper.call(worker, releasedEvent);
              },
            });
            return;
          }
          if (
            !isHelperListener &&
            type === "message" &&
            response.type === "response" &&
            typeof response.token === "number"
          ) {
            diagnosticWindow.__clientMessageDeliveries?.push({
              workerId,
              token: response.token,
              method: request?.method,
              deliveredAt: performance.now(),
              releasedHeldResponse: isReleasedHeldResponse,
            });
          }
          if (typeof listener === "function") listener.call(worker, event);
          else listener.handleEvent(event);
        };
        messageListenerWrappers.set(listener, wrappedListener);
        messageListenerRecords.push({
          listener,
          wrapper: wrappedListener,
          helper: isHelperListener,
          active: true,
        });
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
          const record = messageListenerRecords.find(
            (candidate) => candidate.listener === listener,
          );
          if (record) record.active = false;
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
        } else if (request.type === "notification") {
          const method = request.message?.method ?? "unknown";
          const params = request.message?.params as
            | {
                textDocument?: { uri?: string; version?: number };
                contentChanges?: unknown;
              }
            | undefined;
          const documentVersion = params?.textDocument?.version;
          if (typeof documentVersion === "number")
            observedDocumentVersion = documentVersion;
          if (method === "textDocument/didOpen") {
            observedDocumentText = (
              params?.textDocument as { text?: string } | undefined
            )?.text;
          } else if (method === "textDocument/didChange") {
            const changes = params?.contentChanges as
              Array<{ text?: string }> | undefined;
            const latestChange = changes?.at(-1)?.text;
            if (typeof latestChange === "string")
              observedDocumentText = latestChange;
          } else if (method === "textDocument/didClose") {
            observedDocumentText = undefined;
          }
          observations.push({
            direction: "notification",
            workerId,
            method,
            documentVersion: documentVersion ?? observedDocumentVersion,
            textDocument: params?.textDocument,
            contentChanges: params?.contentChanges,
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
                textDocument?: {
                  uri?: string;
                  version?: number;
                  text?: string;
                };
                position?: unknown;
                contentChanges?: unknown;
                data?: unknown;
              }
            | undefined;
          const messageVersion = params?.textDocument?.version;
          if (typeof messageVersion === "number")
            observedDocumentVersion = messageVersion;
          if (method === "textDocument/didOpen") {
            observedDocumentText = params?.textDocument?.text;
          } else if (method === "textDocument/didChange") {
            const changes = params?.contentChanges as
              Array<{ text?: string }> | undefined;
            const latestChange = changes?.at(-1)?.text;
            if (typeof latestChange === "string")
              observedDocumentText = latestChange;
          } else if (method === "textDocument/didClose") {
            observedDocumentText = undefined;
          }
          const isNotification =
            method === "textDocument/didOpen" ||
            method === "textDocument/didChange" ||
            method === "textDocument/didClose" ||
            method === "initialized";
          const requestContext = {
            method,
            startedAt,
            documentVersion: messageVersion ?? observedDocumentVersion,
            documentText: observedDocumentText,
            position: params?.position,
            data: params?.data,
            item:
              method === "completionItem/resolve"
                ? request.message?.params
                : undefined,
          };
          pending.set(request.token, requestContext);
          requestHistory.set(request.token, requestContext);
          observations.push({
            direction: isNotification ? "notification" : "request",
            workerId,
            token: request.token,
            method,
            documentVersion: messageVersion ?? observedDocumentVersion,
            position: params?.position,
            textDocument: params?.textDocument,
            contentChanges: params?.contentChanges,
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
      const observerMessageListener: EventListener = (event) => {
        const response = (event as MessageEvent<unknown>).data as {
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
          error?: unknown;
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
        if (response.type !== "response" || typeof response.token !== "number")
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
        const resultShape = Array.isArray(result)
          ? "completion-items"
          : result && typeof result === "object" && "items" in result
            ? Array.isArray(result.items)
              ? "completion-list"
              : "invalid"
            : result && typeof result === "object" && "label" in result
              ? "completion-item"
              : "invalid";
        const validItems = Array.isArray(result)
          ? result.every(isCompletionItem)
          : resultShape === "completion-list"
            ? (result as { items: unknown[] }).items.every(isCompletionItem)
            : resultShape === "completion-item"
              ? isCompletionItem(result)
              : false;
        const successfulResult =
          response.error === undefined &&
          rpc?.error === undefined &&
          result !== undefined &&
          validItems;
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
          workerError: response.error,
          rpcError: rpc?.error,
          resultShape,
          successfulResult,
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
      };
      helperMessageListeners.add(observerMessageListener);
      worker.addEventListener("message", observerMessageListener);

      return worker;
    }
    return new NativeWorker(url, options);
  } as unknown as typeof Worker;
  InstrumentedWorker.prototype = NativeWorker.prototype;
  window.Worker = InstrumentedWorker;
}

export function completionResponseForSnapshot(
  events: Array<Record<string, unknown>>,
  {
    workerId,
    source,
    position,
  }: {
    workerId: number;
    source: string;
    position: { line: number; character: number };
  },
) {
  const documentEvent = events
    .filter((event) => {
      if (
        event.direction !== "notification" ||
        event.workerId !== workerId ||
        (event.method !== "textDocument/didOpen" &&
          event.method !== "textDocument/didChange")
      )
        return false;
      const changes = event.contentChanges as
        Array<{ text?: string }> | undefined;
      const openedText = (event.textDocument as { text?: string } | undefined)
        ?.text;
      return (
        normalizeCompletionSource(changes?.at(-1)?.text ?? openedText ?? "") ===
        normalizeCompletionSource(source)
      );
    })
    .at(-1);
  if (!documentEvent) return undefined;

  const documentEventIndex = events.lastIndexOf(documentEvent);
  const matchingRequests = events
    .slice(documentEventIndex + 1)
    .filter(
      (event) =>
        event.direction === "request" &&
        event.workerId === workerId &&
        event.method === "textDocument/completion" &&
        event.documentVersion === documentEvent.documentVersion &&
        JSON.stringify(event.position) === JSON.stringify(position),
    );
  const request = matchingRequests
    .map((candidate) => ({
      request: candidate,
      response: events.find(
        (event) =>
          event.direction === "response" &&
          event.method === "textDocument/completion" &&
          event.workerId === workerId &&
          event.token === candidate.token,
      ),
    }))
    .find((pair) => pair.response)?.request;
  if (!request) return undefined;
  const response = events.find(
    (event) =>
      event.direction === "response" &&
      event.method === "textDocument/completion" &&
      event.workerId === workerId &&
      event.token === request.token,
  );
  if (!response) return undefined;
  return { documentEvent, request, response };
}

export function normalizeCompletionSource(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export function isSuccessfulCompletionResponse(
  response: Record<string, unknown>,
) {
  return response.successfulResult === true;
}

export async function watchAnalysisWorkers(
  page: Page,
  options: {
    holdCompletionResponses?: boolean | { documentSuffix: string };
  } = {},
): Promise<void> {
  await page.addInitScript(
    installCompletionWorkerObserver,
    options.holdCompletionResponses ?? false,
  );
}

export async function heldCompletionResponses(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as CompletionDiagnosticWindow)
        .__heldCompletionResponses ?? [],
  );
}

export async function clientMessageDeliveries(
  page: Page,
  workerId: number,
  token: number,
) {
  return page.evaluate(
    ({ targetWorkerId, targetToken }) =>
      (
        window as unknown as CompletionDiagnosticWindow
      ).__clientMessageDeliveries?.filter(
        (delivery) =>
          delivery.workerId === targetWorkerId &&
          delivery.token === targetToken,
      ) ?? [],
    { targetWorkerId: workerId, targetToken: token },
  );
}

export async function expectHeldClientDeliveryProof(
  page: Page,
  workerId: number,
  token: number,
  expectDelivery: boolean,
) {
  const deliveries = await clientMessageDeliveries(page, workerId, token);
  if (expectDelivery) {
    if (deliveries.length !== 1 || !deliveries[0].releasedHeldResponse)
      throw new Error(
        `Expected one released held response to reach the original client listener; got ${JSON.stringify(deliveries)}`,
      );
  } else if (deliveries.length !== 0) {
    throw new Error(
      `Expected the original client listener to remain uncalled; got ${JSON.stringify(deliveries)}`,
    );
  }
  return deliveries;
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

export async function hasRawCompletionCandidate(
  page: Page,
  responseStart: number,
  label: string,
): Promise<boolean> {
  return page.evaluate(
    ({ start, expectedLabel }) => {
      const events =
        (window as unknown as CompletionDiagnosticWindow).__lspObservations ??
        [];
      return events.slice(start).some((event) => {
        if (
          event.direction !== "response" ||
          event.method !== "textDocument/completion" ||
          !Array.isArray(event.candidates)
        )
          return false;
        return event.candidates.some((candidate: ObservedCompletionItem) => {
          const candidateLabel =
            typeof candidate.label === "string"
              ? candidate.label
              : candidate.label?.label;
          return candidateLabel === expectedLabel;
        });
      });
    },
    { start: responseStart, expectedLabel: label },
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
