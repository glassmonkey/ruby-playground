import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// Imported once, exactly like the browser does: a module script runs a single
// time per document and the module then reacts to turbo:load for every page
// Turbo renders. Re-importing per test would stack up one listener per import.
import "../src/index.js";

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

function setUpDom({ withSaveForm = false } = {}) {
  document.body.innerHTML = `
    <textarea id="code">puts 1</textarea>
    <span id="spinner" hidden></span>
    <pre id="output" role="status">Loading ruby.wasm...</pre>
    ${withSaveForm ? '<input type="hidden" id="snippet-code-field">' : ""}
  `;
}

// The one signal Turbo gives a page: everything the module does hangs off it.
function renderPage() {
  document.dispatchEvent(new Event("turbo:load"));
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

  test("marks output as an alert when the worker reports ok: false", () => {
    renderPage();
    const worker = MockWorker.instances[0];
    const output = document.getElementById("output");

    worker.onmessage({ data: { ok: false, error: "boom" } });

    expect(output.classList.contains("error")).toBe(true);
    expect(output.getAttribute("role")).toBe("alert");
    expect(output.textContent).toBe("Error: boom");
  });

  test("clears the error state when the worker reports ok: true", () => {
    renderPage();
    const worker = MockWorker.instances[0];
    const output = document.getElementById("output");
    output.classList.add("error");
    output.setAttribute("role", "alert");

    worker.onmessage({ data: { ok: true, result: "42" } });

    expect(output.classList.contains("error")).toBe(false);
    expect(output.getAttribute("role")).toBe("status");
    expect(output.textContent).toBe("42");
  });

  test("marks output as an alert on a worker-level error event", () => {
    renderPage();
    const worker = MockWorker.instances[0];
    const output = document.getElementById("output");

    worker.onerror({ message: "script died" });

    expect(output.classList.contains("error")).toBe(true);
    expect(output.getAttribute("role")).toBe("alert");
    expect(output.textContent).toBe("Error: script died");
  });
});

describe("starting up under Turbo", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("runs the editor's code once per rendered playground page", () => {
    setUpDom();

    renderPage();

    expect(MockWorker.instances).toHaveLength(1);
  });

  test("starts nothing on a page that has no editor", () => {
    document.body.innerHTML = "<h1>My snippets</h1>";

    renderPage();

    expect(MockWorker.instances).toHaveLength(0);
  });

  test("does not start a second worker when turbo:load fires twice for one page", () => {
    setUpDom();
    renderPage();

    renderPage();

    expect(MockWorker.instances).toHaveLength(1);
  });

  test("drops the running worker before Turbo renders the next page", () => {
    setUpDom();
    renderPage();
    const worker = MockWorker.instances[0];

    document.dispatchEvent(new Event("turbo:before-render"));

    expect(worker.terminated).toBe(true);
  });
});

describe("leaving a page while a run is still pending", () => {
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

  test("does not rewrite the URL of the page Turbo navigated to", () => {
    renderPage();
    const pushState = vi.spyOn(history, "pushState");
    const codeInput = document.getElementById("code");
    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));

    document.body.innerHTML = "<h1>My snippets</h1>"; // Turbo swaps the body
    vi.advanceTimersByTime(300);

    expect(pushState).not.toHaveBeenCalled();
  });

  test("drops a pending run as soon as a Turbo visit starts", () => {
    renderPage();
    const pushState = vi.spyOn(history, "pushState");
    const codeInput = document.getElementById("code");
    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));

    // The body is still in place here, exactly as it is while Turbo fetches the
    // next page: only the cancellation keeps the URL from being rewritten.
    document.dispatchEvent(new Event("turbo:visit"));
    vi.advanceTimersByTime(300);

    expect(pushState).not.toHaveBeenCalled();
  });

  test("drops a pending run as soon as a Turbo form submission starts", () => {
    renderPage();
    const pushState = vi.spyOn(history, "pushState");
    const codeInput = document.getElementById("code");
    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));

    document.dispatchEvent(new Event("turbo:submit-start"));
    vi.advanceTimersByTime(300);

    expect(pushState).not.toHaveBeenCalled();
  });

  test("does not start a Ruby VM for a page that is already gone", () => {
    renderPage();
    const codeInput = document.getElementById("code");
    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    MockWorker.instances = [];

    document.body.innerHTML = "<h1>My snippets</h1>"; // Turbo swaps the body
    vi.advanceTimersByTime(300);

    expect(MockWorker.instances).toHaveLength(0);
  });
});

describe("keeping the save form's hidden code field in step with the editor", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker);
    vi.useFakeTimers();
    setUpDom({ withSaveForm: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("seeds the hidden field from the editor on load", () => {
    renderPage();

    const got = document.getElementById("snippet-code-field").value;

    expect(got).toBe("puts 1");
  });

  test("updates the hidden field on the keystroke, not after the run debounce", () => {
    renderPage();
    const codeInput = document.getElementById("code");

    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));

    // Deliberately no timer advance: hitting Save straight after typing must not
    // store the previous revision just because the 300ms run debounce is pending.
    const got = document.getElementById("snippet-code-field").value;

    expect(got).toBe("puts 2");
  });
});
