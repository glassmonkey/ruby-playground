import { decodeSharedCode, urlSearchWithCode } from "./url-sharing.js";

const codeInput = document.getElementById("code");
const output = document.getElementById("output");
const spinner = document.getElementById("spinner");

let currentWorker = null;
let debounceTimer = null;

// If the page was loaded with a shared `c` param, it overrides whatever's
// in the textarea.
const sharedCode = decodeSharedCode(location.search);
if (sharedCode) codeInput.value = sharedCode;

function updateUrlWithCode(code) {
  // pushState only: we don't want a navigation/reload on every keystroke.
  history.pushState(null, "", urlSearchWithCode(location.search, code));
}

function runCode(code) {
  // ADR-0010: terminate the previous worker (and its Ruby VM) entirely and
  // start a fresh one for every run, so state never persists between runs.
  if (currentWorker) currentWorker.terminate();

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
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    runCode(codeInput.value);
    updateUrlWithCode(codeInput.value);
  }, 300);
});

// Run once on load with whatever's already in the textarea.
runCode(codeInput.value);
