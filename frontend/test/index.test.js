import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { decodeSharedCode } from "../src/url-sharing.js";

class MockWorker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    MockWorker.instances.push(this);
  }

  postMessage(message) {
    this.lastMessage = message;
  }

  terminate() {
    this.terminated = true;
  }
}
MockWorker.instances = [];

function setUpDom() {
  document.body.innerHTML = `
    <textarea id="code">puts 1</textarea>
    <span id="spinner" hidden></span>
    <pre id="output" role="status">Loading ruby.wasm...</pre>
  `;
}

async function loadIndexModule() {
  vi.resetModules();
  await import("../src/index.js");
}

describe("error styling on Worker responses", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker);
    setUpDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("marks output as an alert when the worker reports ok: false", async () => {
    await loadIndexModule();
    const worker = MockWorker.instances[0];
    const output = document.getElementById("output");

    worker.onmessage({ data: { ok: false, error: "boom" } });

    expect(output.classList.contains("error")).toBe(true);
    expect(output.getAttribute("role")).toBe("alert");
    expect(output.textContent).toBe("Error: boom");
  });

  test("clears the error state when the worker reports ok: true", async () => {
    await loadIndexModule();
    const worker = MockWorker.instances[0];
    const output = document.getElementById("output");
    output.classList.add("error");
    output.setAttribute("role", "alert");

    worker.onmessage({ data: { ok: true, result: "42" } });

    expect(output.classList.contains("error")).toBe(false);
    expect(output.getAttribute("role")).toBe("status");
    expect(output.textContent).toBe("42");
  });

  test("marks output as an alert on a worker-level error event", async () => {
    await loadIndexModule();
    const worker = MockWorker.instances[0];
    const output = document.getElementById("output");

    worker.onerror({ message: "script died" });

    expect(output.classList.contains("error")).toBe(true);
    expect(output.getAttribute("role")).toBe("alert");
    expect(output.textContent).toBe("Error: script died");
  });
});

describe("debounce and worker lifecycle on code input", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker);
    vi.useFakeTimers();
    setUpDom();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("does not run the code before the 300ms debounce delay elapses", async () => {
    await loadIndexModule();
    const codeInput = document.getElementById("code");

    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(299);

    expect(MockWorker.instances).toHaveLength(1);
  });

  test("runs the code once the 300ms debounce delay elapses", async () => {
    await loadIndexModule();
    const codeInput = document.getElementById("code");

    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(300);

    expect(MockWorker.instances).toHaveLength(2);
    expect(MockWorker.instances[1].lastMessage).toEqual({ code: "puts 2" });
  });

  test("collapses rapid successive inputs into a single run using the latest value", async () => {
    await loadIndexModule();
    const codeInput = document.getElementById("code");

    codeInput.value = "puts 1";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(100);
    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(100);
    codeInput.value = "puts 3";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(300);

    expect(MockWorker.instances).toHaveLength(2);
    expect(MockWorker.instances[1].lastMessage).toEqual({ code: "puts 3" });
  });

  test("terminates the previous worker and starts a fresh one for every run", async () => {
    await loadIndexModule();
    const codeInput = document.getElementById("code");
    const initialWorker = MockWorker.instances[0];

    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(300);
    const firstRunWorker = MockWorker.instances[1];

    codeInput.value = "puts 3";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(300);
    const secondRunWorker = MockWorker.instances[2];

    expect(initialWorker.terminated).toBe(true);
    expect(firstRunWorker.terminated).toBe(true);
    expect(secondRunWorker.terminated).toBe(false);
    expect(new Set([initialWorker, firstRunWorker, secondRunWorker]).size).toBe(3);
  });

  test("updates the browser URL via pushState without causing navigation", async () => {
    await loadIndexModule();
    const codeInput = document.getElementById("code");
    const pushStateSpy = vi.spyOn(history, "pushState");

    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(300);

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(decodeSharedCode(location.search)).toBe("puts 2");
  });
});
