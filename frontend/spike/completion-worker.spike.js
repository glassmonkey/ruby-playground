// Spike experiment for issue #13: a persistent completion worker.
//
// Unlike src/worker.js (which creates+discards a Ruby VM per message, per
// ADR-0010's terminate/recreate execution model), this worker initializes
// the Ruby VM ONCE on first message and reuses it for every subsequent
// completion query. It is NOT part of the terminate/recreate lifecycle.
//
// This file exists only to measure completion-query latency for the issue
// #13 feasibility spike; it is not wired into the app.
import { DefaultRubyVM } from "@ruby/wasm-wasi/dist/browser";

let vmPromise = null;

function getVM() {
  if (!vmPromise) {
    vmPromise = (async () => {
      const response = await fetch("/ruby-wasm/ruby.wasm");
      const buffer = await response.arrayBuffer();
      const module = await WebAssembly.compile(buffer);
      const { vm } = await DefaultRubyVM(module);
      return vm;
    })();
  }
  return vmPromise;
}

self.onmessage = async (event) => {
  const { id, code } = event.data;
  try {
    const vm = await getVM();
    const result = vm.eval(code);
    self.postMessage({ id, ok: true, result: result.toString() });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
