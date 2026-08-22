import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

const codeInput = document.getElementById("code");
const output = document.getElementById("output");
const spinner = document.getElementById("spinner");

let currentWorker = null;
let debounceTimer = null;

// ADR-0011: instant sharing goes through the URL's `c` param (lz-string
// compressed code), no DB involved. If the page was loaded with one,
// it overrides whatever's in the textarea.
const sharedCode = decompressFromEncodedURIComponent(
  new URLSearchParams(location.search).get("c") ?? "",
);
if (sharedCode) codeInput.value = sharedCode;

function updateUrlWithCode(code) {
  const params = new URLSearchParams(location.search);
  params.set("c", compressToEncodedURIComponent(code));
  // pushState only: we don't want a navigation/reload on every keystroke.
  history.pushState(null, "", `?${params.toString()}`);
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
    output.textContent = ok ? result : `Error: ${error}`;
  };

  currentWorker.onerror = (event) => {
    spinner.hidden = true;
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
