import { DefaultRubyVM } from "@ruby/wasm-wasi/dist/browser";

self.onmessage = async (event) => {
  const { code } = event.data;
  try {
    const response = await fetch("/ruby-wasm/ruby.wasm");
    const buffer = await response.arrayBuffer();
    const module = await WebAssembly.compile(buffer);
    const { vm } = await DefaultRubyVM(module);

    const result = vm.eval(code);
    self.postMessage({ ok: true, result: result.toString() });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
