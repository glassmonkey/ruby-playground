import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
