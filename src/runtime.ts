import { RubyVM } from "@ruby/wasm-wasi";
import {
  ConsoleStdout,
  File,
  OpenFile,
  PreopenDirectory,
  WASI,
} from "@bjorn3/browser_wasi_shim";

export const MAX_OUTPUT_BYTES = 100_000;
export type RunResult = {
  stdout: string;
  stderr: string;
  output: string;
  error?: string;
};

/** A new VM and filesystem per call; capture writes, never eval's return value. */
export async function executeRuby(
  module: WebAssembly.Module,
  code: string,
): Promise<RunResult> {
  const result: RunResult = { stdout: "", stderr: "", output: "" };
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  let bytes = 0;
  const capture = (stream: "stdout" | "stderr") => (data: Uint8Array) => {
    bytes += data.byteLength;
    if (bytes > MAX_OUTPUT_BYTES)
      throw new Error("Output limit exceeded (100 KB).");
    const text = decoders[stream].decode(data, { stream: true });
    result[stream] += text;
    result.output += text;
  };
  try {
    const wasi = new WASI(
      [],
      [],
      [
        new OpenFile(new File([])),
        new ConsoleStdout(capture("stdout")),
        new ConsoleStdout(capture("stderr")),
        new PreopenDirectory("/", new Map()),
      ],
    );
    let initializing = true;
    const { vm } = await RubyVM.instantiateModule({
      module,
      wasip1: wasi,
      addToImports: (imports) => {
        // Ruby-only scope: do not expose Worker globals, fetch or postMessage to Ruby.
        for (const [name, original] of Object.entries(
          imports["rb-js-abi-host"],
        )) {
          if (
            name === "rb_wasm_throw_prohibit_rewind_exception" ||
            typeof original !== "function"
          )
            continue;
          imports["rb-js-abi-host"][name] = (...args: number[]) => {
            if (!initializing)
              throw new Error(
                "JavaScript bridge is disabled in this playground.",
              );
            return original(...args);
          };
        }
      },
    });
    initializing = false;
    vm.eval("$stdout.sync = true; $stderr.sync = true");
    vm.eval(code);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    for (const stream of ["stdout", "stderr"] as const) {
      const tail = decoders[stream].decode();
      result[stream] += tail;
      result.output += tail;
    }
  }
  return result;
}
