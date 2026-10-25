import ruby40Url from "@ruby/4.0-wasm-wasi/dist/ruby+stdlib.wasm?url";
import ruby34Url from "@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm?url";
import ruby33Url from "@ruby/3.3-wasm-wasi/dist/ruby+stdlib.wasm?url";
import { isRubyVersion, type RubyVersion } from "../versions";
import { executeRuby } from "../runtime";

const rubyUrls: Record<RubyVersion, string> = {
  "4.0": ruby40Url,
  "3.4": ruby34Url,
  "3.3": ruby33Url,
};

self.onmessage = async (
  event: MessageEvent<{ code: string; version: RubyVersion }>,
) => {
  try {
    if (!isRubyVersion(event.data.version))
      throw new Error("Unsupported Ruby version.");
    const response = await fetch(rubyUrls[event.data.version]);
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
