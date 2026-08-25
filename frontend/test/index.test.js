import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { decodeSharedCode } from "../src/url-sharing.js";
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

// startPlayground reads location.search for a shared `c` param and lets it
// override the editor, so a pushState left behind by an earlier test would
// silently rewrite the next test's starting code. One document, one location:
// reset it for every test in the file.
beforeEach(() => {
  history.replaceState(null, "", "/");
});

// vi.spyOn does not restore itself, and spying twice on the same method hands
// back the existing mock with its call history intact -- so a pushState count
// from one describe would otherwise be read as a call by the next one.
afterEach(() => {
  vi.restoreAllMocks();
});

function setUpDom() {
  document.body.innerHTML = `
    <textarea id="code">puts 1</textarea>
    <span id="spinner" hidden></span>
    <pre id="output" role="status">Loading ruby.wasm...</pre>
  `;
}

// The one signal Turbo gives a page: everything the module does hangs off it.
function renderPage() {
  document.dispatchEvent(new Event("turbo:load"));
}

// jsdom sends an exception thrown inside a listener to window's error event
// instead of back out through dispatchEvent, so a module that blows up on a
// page it did not expect would otherwise leave renderPage() looking successful.
function errorsDuring(run) {
  const errors = [];
  const collect = (event) => errors.push(event.message);
  window.addEventListener("error", collect);
  try {
    run();
  } finally {
    window.removeEventListener("error", collect);
  }
  return errors;
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

  test("does not run the code before the 300ms debounce delay elapses", () => {
    renderPage();
    const codeInput = document.getElementById("code");

    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(299);

    expect(MockWorker.instances).toHaveLength(1);
  });

  test("runs the code once the 300ms debounce delay elapses", () => {
    renderPage();
    const codeInput = document.getElementById("code");

    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(300);

    expect(MockWorker.instances).toHaveLength(2);
    expect(MockWorker.instances[1].lastMessage).toEqual({ code: "puts 2" });
  });

  test("collapses rapid successive inputs into a single run using the latest value", () => {
    renderPage();
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

  test("terminates the previous worker and starts a fresh one for every run", () => {
    renderPage();
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

  test("updates the browser URL via pushState without causing navigation", () => {
    renderPage();
    const codeInput = document.getElementById("code");
    const pushStateSpy = vi.spyOn(history, "pushState");

    codeInput.value = "puts 2";
    codeInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(300);

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(decodeSharedCode(location.search)).toBe("puts 2");
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

  test("wires up a playground Turbo renders after a page that had no editor", () => {
    document.body.innerHTML = "<h1>Sign in</h1>";
    renderPage();

    setUpDom();
    renderPage();

    expect(MockWorker.instances).toHaveLength(1);
  });

  test("does nothing at all on a page that has no editor", () => {
    setUpDom();
    renderPage(); // the module is now holding a playground page's editor
    MockWorker.instances = [];

    const errors = errorsDuring(() => {
      document.body.innerHTML = "<h1>Sign in</h1>";
      renderPage();
    });

    expect(errors).toEqual([]);
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

    document.body.innerHTML = "<h1>Sign in</h1>"; // Turbo swaps the body
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

    document.body.innerHTML = "<h1>Sign in</h1>"; // Turbo swaps the body
    vi.advanceTimersByTime(300);

    expect(MockWorker.instances).toHaveLength(0);
  });
});
