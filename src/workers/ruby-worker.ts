import rubyUrl from "@ruby/4.0-wasm-wasi/dist/ruby+stdlib.wasm?url";
import { executeRuby } from "../runtime";

self.onmessage = async (event: MessageEvent<{ code: string }>) => {
  try {
    const response = await fetch(rubyUrl);
    if (!response.ok)
      throw new Error(`Ruby download failed (${response.status}).`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    self.postMessage(await executeRuby(module, event.data.code));
  } catch (error) {
    self.postMessage({
      stdout: "",
      stderr: "",
      output: "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
