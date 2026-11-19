import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import {
  completionResponseForSnapshot,
  isSuccessfulCompletionResponse,
  installCompletionWorkerObserver,
} from "./completion-lsp-observer.ts";

const clientDeliveries = [];
const sessionValues = new Map();
const listenerErrors = [];

class FakeMessageEvent extends Event {
  constructor(type, { data }) {
    super(type);
    this.data = data;
    this.stopped = false;
  }

  stopImmediatePropagation() {
    this.stopped = true;
    super.stopImmediatePropagation();
  }
}

class FakeWorker {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  postMessage() {}

  terminate() {}

  dispatchEvent(event) {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      try {
        listener.call(this, event);
      } catch (error) {
        listenerErrors.push(String(error));
      }
      if (event.stopped) break;
    }
    return true;
  }
}

const sessionStorage = {
  getItem(key) {
    return sessionValues.get(key) ?? null;
  },
  setItem(key, value) {
    sessionValues.set(key, value);
  },
};
const browserWindow = {
  location: { href: "http://127.0.0.1:6645/" },
  Worker: FakeWorker,
};
const serializedInitializer = `(${installCompletionWorkerObserver.toString()})({ documentSuffix: ".upc" })`;
runInNewContext(serializedInitializer, {
  window: browserWindow,
  sessionStorage,
  performance,
  URL,
  MessageEvent: FakeMessageEvent,
});

function createCompletionWorker({ token, version, source }) {
  const worker = new browserWindow.Worker("/worker-client.js");
  worker.addEventListener("message", (event) => {
    clientDeliveries.push({ type: event.data.type, token: event.data.token });
  });
  worker.postMessage({
    type: "request",
    token: token - 1,
    message: {
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: "file:///playground/main.rb", version },
        contentChanges: [{ text: source }],
      },
    },
  });
  worker.postMessage({
    type: "request",
    token,
    message: {
      method: "textDocument/completion",
      params: {
        textDocument: { uri: "file:///playground/main.rb", version },
        position: { line: 0, character: source.length },
      },
    },
  });
  return worker;
}

function dispatchCompletion(worker, { token, result, error, rpcError }) {
  worker.dispatchEvent(
    new FakeMessageEvent("message", {
      data: {
        type: "response",
        token,
        ...(error ? { error } : {}),
        responses: rpcError
          ? [{ id: 1, error: rpcError }]
          : [{ id: 1, result }],
      },
    }),
  );
}

const worker = createCompletionWorker({
  token: 8,
  version: 23,
  source: 'puts "hello".upc',
});
dispatchCompletion(worker, {
  token: 8,
  result: [{ label: "upcase" }],
});

const held = browserWindow.__heldCompletionResponses;
assert.deepEqual(listenerErrors, []);
assert.equal(clientDeliveries.length, 0);
assert.equal(held.length, 1);
assert.equal(held[0].token, 8);
assert.equal(held[0].documentVersion, 23);
assert.equal(held[0].documentText, 'puts "hello".upc');
assert.deepEqual(held[0].position, { line: 0, character: 16 });
assert.equal(held[0].observerMessageListenerCount, 1);
assert.equal(held[0].clientMessageListenerCount, 1);
assert.equal(held[0].clientDeliveriesBeforeRelease, 0);
assert.equal(
  browserWindow.__lspObservations.filter(
    (entry) => entry.direction === "response" && entry.token === 8,
  ).length,
  1,
);

const newSource = "box = Object.new\nputs box.upc";
const newDocument = {
  direction: "notification",
  workerId: 1,
  method: "textDocument/didChange",
  documentVersion: 24,
  contentChanges: [{ text: newSource }],
};
const newRequest = {
  direction: "request",
  workerId: 1,
  token: 10,
  method: "textDocument/completion",
  documentVersion: 24,
  position: { line: 1, character: 12 },
};
const oldResponseOnlySnapshot = completionResponseForSnapshot(
  [...browserWindow.__lspObservations, newDocument, newRequest],
  { workerId: 1, source: newSource, position: newRequest.position },
);
assert.equal(oldResponseOnlySnapshot, undefined);
const currentResponse = {
  direction: "response",
  workerId: 1,
  token: 10,
  method: "textDocument/completion",
  candidates: [],
  successfulResult: true,
};
const currentSnapshot = completionResponseForSnapshot(
  [
    ...browserWindow.__lspObservations,
    newDocument,
    newRequest,
    currentResponse,
  ],
  { workerId: 1, source: newSource, position: newRequest.position },
);
assert.equal(currentSnapshot?.response.token, 10);
assert.deepEqual(currentSnapshot?.response.candidates, []);
assert.equal(isSuccessfulCompletionResponse(currentSnapshot.response), true);

function observeCompletionResult({ token, source, result, error, rpcError }) {
  const diagnosticWorker = createCompletionWorker({
    token,
    version: token,
    source,
  });
  dispatchCompletion(diagnosticWorker, { token, result, error, rpcError });
  const workerId = browserWindow.__analysisWorkerUrls.length;
  const snapshot = completionResponseForSnapshot(
    browserWindow.__lspObservations,
    {
      workerId,
      source,
      position: { line: 0, character: source.length },
    },
  );
  return snapshot?.response;
}

const normalEmpty = observeCompletionResult({
  token: 12,
  source: "box.upc",
  result: [],
});
assert.equal(isSuccessfulCompletionResponse(normalEmpty), true);
assert.deepEqual(normalEmpty.candidates, []);

const transportFailure = observeCompletionResult({
  token: 14,
  source: "box.upc",
  error: "worker dispatch failed",
});
assert.equal(transportFailure.workerError, "worker dispatch failed");
assert.equal(isSuccessfulCompletionResponse(transportFailure), false);

const rpcFailure = observeCompletionResult({
  token: 16,
  source: "box.upc",
  rpcError: { code: -32603, message: "analysis failed" },
});
assert.deepEqual(rpcFailure.rpcError, {
  code: -32603,
  message: "analysis failed",
});
assert.equal(isSuccessfulCompletionResponse(rpcFailure), false);

const malformedResult = observeCompletionResult({
  token: 18,
  source: "box.upc",
  result: { entries: [] },
});
assert.equal(malformedResult.resultShape, "invalid");
assert.equal(isSuccessfulCompletionResponse(malformedResult), false);

assert.equal(browserWindow.__releaseHeldCompletionResponse(1, 8), true);
assert.deepEqual(clientDeliveries, [{ type: "response", token: 8 }]);
assert.deepEqual(listenerErrors, []);
assert.equal(
  browserWindow.__lspObservations.filter(
    (entry) => entry.direction === "response" && entry.token === 8,
  ).length,
  1,
);

console.log(
  JSON.stringify(
    {
      serializedInitializerUsed: true,
      contract:
        "observer/client separation, exact held release, successful empty/nonempty result and error classification",
      workerId: held[0].workerId,
      token: held[0].token,
      documentVersion: held[0].documentVersion,
      documentText: held[0].documentText,
      position: held[0].position,
      clientCallsBeforeRelease: 0,
      clientCallsAfterRelease: clientDeliveries.length,
      observerResponseCount: 1,
      oldResponseOnlyCannotCompleteNewSnapshot:
        oldResponseOnlySnapshot === undefined,
      matchingNoCandidateResponseToken: currentSnapshot?.response.token,
      normalEmptyIsSuccessful:
        isSuccessfulCompletionResponse(normalEmpty) &&
        normalEmpty.candidates.length === 0,
      workerErrorIsNotEmptySuccess:
        isSuccessfulCompletionResponse(transportFailure) === false,
      rpcErrorIsNotEmptySuccess:
        isSuccessfulCompletionResponse(rpcFailure) === false,
      malformedResultIsNotEmptySuccess:
        isSuccessfulCompletionResponse(malformedResult) === false,
      listenerErrors,
    },
    null,
    2,
  ),
);
