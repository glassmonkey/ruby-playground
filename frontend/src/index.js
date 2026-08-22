const codeInput = document.getElementById("code");
const output = document.getElementById("output");
const spinner = document.getElementById("spinner");

let currentWorker = null;
let debounceTimer = null;

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
    output.textContent = ok ? result : `Error: ${error}`;
  };

  currentWorker.onerror = (event) => {
    spinner.hidden = true;
    output.classList.add("error");
    output.textContent = `Error: ${event.message}`;
  };

  currentWorker.postMessage({ code });
}

codeInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runCode(codeInput.value), 300);
});

// Run once on load with whatever's already in the textarea.
runCode(codeInput.value);
