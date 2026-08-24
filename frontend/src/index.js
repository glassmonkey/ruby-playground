import { decodeSharedCode, urlSearchWithCode } from "./url-sharing.js";

let currentWorker = null;
let pendingRun = null;
// Which editor element is already wired up. Kept here rather than as a data-
// attribute on the element: Turbo snapshots the DOM into its page cache, and a
// marker baked into that snapshot would make a restored page look initialised.
let wiredEditor = null;

function terminateWorker() {
  if (currentWorker) currentWorker.terminate();
  currentWorker = null;
}

function cancelPendingRun() {
  clearTimeout(pendingRun);
  pendingRun = null;
}

function startPlayground() {
  const codeInput = document.getElementById("code");
  if (!codeInput) return; // this bundle also loads on pages without an editor
  // Turbo hands us a brand new textarea on every page, so the element identity
  // is the honest record of whether this page is wired up yet -- and it stops
  // the import-time call below from doubling up with the turbo:load one.
  if (wiredEditor === codeInput) return;
  wiredEditor = codeInput;

  const output = document.getElementById("output");
  const spinner = document.getElementById("spinner");
  // Only rendered for signed-in visitors; the playground itself works without it.
  const saveCodeField = document.getElementById("snippet-code-field");

  // If the page was loaded with a shared `c` param, it overrides whatever's
  // in the textarea.
  const sharedCode = decodeSharedCode(location.search);
  if (sharedCode) codeInput.value = sharedCode;

  function updateUrlWithCode(code) {
    // pushState only: we don't want a navigation/reload on every keystroke.
    history.pushState(null, "", urlSearchWithCode(location.search, code));
  }

  // The save form posts the code as an ordinary field, so it has to track the
  // editor rather than the debounced `c` param -- saving right after a keystroke
  // must not store the previous revision.
  function syncSaveField(code) {
    if (saveCodeField) saveCodeField.value = code;
  }

  function runCode(code) {
    // ADR-0010: terminate the previous worker (and its Ruby VM) entirely and
    // start a fresh one for every run, so state never persists between runs.
    terminateWorker();

    currentWorker = new Worker("/ruby-wasm/worker.js", { type: "module" });
    spinner.hidden = false;

    currentWorker.onmessage = (event) => {
      const { ok, result, error } = event.data;
      spinner.hidden = true;
      output.classList.toggle("error", !ok);
      output.setAttribute("role", ok ? "status" : "alert");
      output.textContent = ok ? result : `Error: ${error}`;
    };

    currentWorker.onerror = (event) => {
      spinner.hidden = true;
      output.classList.add("error");
      output.setAttribute("role", "alert");
      output.textContent = `Error: ${event.message}`;
    };

    currentWorker.postMessage({ code });
  }

  codeInput.addEventListener("input", () => {
    syncSaveField(codeInput.value);
    cancelPendingRun();
    pendingRun = setTimeout(() => {
      // Backstop for a page swap we were not told about: the listeners below
      // cancel this timer on the navigations Turbo announces, and this covers
      // anything that replaces the body without announcing it.
      if (!codeInput.isConnected) return;

      runCode(codeInput.value);
      updateUrlWithCode(codeInput.value);
    }, 300);
  });

  // Run once on load with whatever's already in the textarea.
  syncSaveField(codeInput.value);
  runCode(codeInput.value);
}

// Two entry points, because a module script runs exactly once per document no
// matter how often Turbo re-inserts its tag:
//   - at import time, for the load that first pulls this file in (which, when
//     Turbo navigates here from another page, happens *after* that page's
//     turbo:load has already fired -- listening alone would miss it entirely);
//   - on turbo:load, for every later visit that swaps a fresh body in.
startPlayground();
document.addEventListener("turbo:load", startPlayground);
// A pending run has to die the moment a navigation *starts*, not when it lands:
// its pushState would otherwise rewrite the URL out from under the visit still
// in flight, desyncing Turbo's history so that the next click goes nowhere.
document.addEventListener("turbo:visit", cancelPendingRun);
document.addEventListener("turbo:submit-start", cancelPendingRun);
// A Worker outlives the body swap it was started under, so drop it before Turbo
// renders the next page rather than leaking a Ruby VM per visit.
document.addEventListener("turbo:before-render", terminateWorker);
