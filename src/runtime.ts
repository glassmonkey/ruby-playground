import { RubyVM } from "@ruby/wasm-wasi";
import {
  ConsoleStdout,
  File,
  OpenFile,
  PreopenDirectory,
  WASI,
  type Inode,
} from "@bjorn3/browser_wasi_shim";
import {
  activateInstalledGems,
  installGems,
  resolveGems,
  type GemRequest,
  type GemSource,
  type ResolvedGem,
} from "./gems";

export const MAX_OUTPUT_BYTES = 100_000;
export type RuntimeInfo = {
  version: string;
  platform: string;
  releaseDate: string;
  revision: string;
  encoding: string;
};

export type RunResult = {
  stdout: string;
  stderr: string;
  output: string;
  error?: string;
};

/** Experiment: Gemfile entries to resolve and install before user code runs. */
export type GemSetup = GemSource & {
  requests: GemRequest[];
  /** Versions pinned by a shared URL; resolution is skipped when present. */
  locked?: ResolvedGem[];
  /** Called only for a fresh resolution, not for locked versions. */
  onResolved?: (gems: ResolvedGem[]) => void;
  /** Awaited after every gem is extracted, before user code runs. */
  onInstalled?: () => void | Promise<void>;
};

type OutputCapture = (
  stream: "stdout" | "stderr",
) => (data: Uint8Array) => void;

async function instantiateRubyVM(
  module: WebAssembly.Module,
  gemFiles: Map<string, Inode>,
  capture: OutputCapture,
): Promise<RubyVM> {
  const wasi = new WASI(
    [],
    [],
    [
      new OpenFile(new File([])),
      new ConsoleStdout(capture("stdout")),
      new ConsoleStdout(capture("stderr")),
      new PreopenDirectory("/", new Map()),
      new PreopenDirectory("/gems", gemFiles),
    ],
    // The shim logs every failed path lookup unless debug is explicitly false;
    // a gem require probes thousands of paths and the console logging dominates.
    { debug: false },
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
  return vm;
}

/** A new VM and filesystem per call; capture writes, never eval's return value. */
export async function executeRuby(
  module: WebAssembly.Module,
  code: string,
  onRuntimeInfo?: (info: RuntimeInfo) => void,
  gems?: GemSetup,
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
    // Gem setup uses a disposable VM. The fresh user VM shares only the gem
    // filesystem so RubyGems setup activations cannot affect the user's code.
    const gemFiles = new Map<string, Inode>();
    let vm = await instantiateRubyVM(module, gemFiles, capture);
    if (onRuntimeInfo) {
      // Both VMs use this module, so report once before setup starts.
      onRuntimeInfo({
        version: vm.eval("RUBY_VERSION").toString(),
        platform: vm.eval("RUBY_PLATFORM").toString(),
        releaseDate: vm.eval("RUBY_RELEASE_DATE").toString(),
        revision: vm.eval("RUBY_REVISION.to_s").toString(),
        encoding: vm.eval("Encoding.default_external.name").toString(),
      });
    }
    if (gems && gems.requests.length > 0) {
      const resolved =
        gems.locked ?? (await resolveGems(vm, gemFiles, gems.requests, gems));
      if (!gems.locked) gems.onResolved?.(resolved);
      await installGems(vm, gemFiles, resolved, gems);
      vm = await instantiateRubyVM(module, gemFiles, capture);
      activateInstalledGems(vm);
      await gems.onInstalled?.();
    }
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
