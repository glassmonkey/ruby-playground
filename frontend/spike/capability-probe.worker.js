// Capability probe worker for issue #29 (論点7 選択肢A: 設計判断の前に
// ruby.wasm の能力だけを潰す先行調査).
//
// This worker owns one persistent Ruby VM and evaluates whatever probe
// snippet the driver sends it. It deliberately does NOT own the probe list
// or any timeout policy: some probes are expected to hang the VM outright
// (that is the thing being measured), and a hung VM cannot report its own
// hang. The driver (capability-probe.js) holds the list, the per-probe
// deadline, and the terminate/recreate recovery.
//
// Not wired into the app. Built by `node frontend/spike/build.mjs` into
// public/ruby-wasm/spike/ (gitignored), served as a static page.
import { DefaultRubyVM } from "@ruby/wasm-wasi/dist/browser";
import { RubyVM } from "@ruby/wasm-wasi";
import { File, OpenFile, PreopenDirectory, WASI } from "@bjorn3/browser_wasi_shim";

let vm = null;
let rubyModule = null;
let wasmUrl = "/ruby-wasm/ruby.wasm";

async function boot() {
  const t0 = performance.now();
  const response = await fetch(wasmUrl);
  const buffer = await response.arrayBuffer();
  const tFetched = performance.now();
  rubyModule = await WebAssembly.compile(buffer);
  const tCompiled = performance.now();
  ({ vm } = await DefaultRubyVM(rubyModule));
  const tReady = performance.now();

  return {
    bytes: buffer.byteLength,
    fetchMs: tFetched - t0,
    compileMs: tCompiled - tFetched,
    vmInitMs: tReady - tCompiled,
    totalMs: tReady - t0,
  };
}

// Instantiate a *second* VM from the already-compiled WebAssembly.Module.
// This isolates "how expensive is a fresh VM once fetch+compile are paid
// for", which is the actual per-recovery cost of a terminate-free reset.
async function secondVM() {
  const t0 = performance.now();
  const { vm: vm2 } = await DefaultRubyVM(rubyModule);
  const tReady = performance.now();
  const tEval0 = performance.now();
  const out = vm2.eval("1 + 1").toString();
  const tEval1 = performance.now();
  return {
    vmInitMs: tReady - t0,
    firstEvalMs: tEval1 - tEval0,
    firstEvalResult: out,
  };
}

// DefaultRubyVM preopens an empty in-memory "/" and nothing else. Whether we
// can hand the VM extra files from JS decides whether signatures or a pure-Ruby
// library that is missing from the bundle (rbs, for one) could be shipped
// alongside it, so build the same VM with one extra preopened directory.
async function mountTest(extraFileCount) {
  const encoder = new TextEncoder();
  const contents = new Map();
  contents.set(
    "injected.rb",
    new File(encoder.encode('module Injected\n  MESSAGE = "hello from a JS-mounted file"\nend\n')),
  );
  contents.set(
    "hello.rbs",
    new File(encoder.encode("class Foo\n  def bar: () -> String\nend\n")),
  );
  // Stand-in for a signature set, to price mounting many files at once.
  for (let i = 0; i < extraFileCount; i += 1) {
    contents.set(`filler_${i}.rbs`, new File(encoder.encode(`class Filler${i}\n  def n: () -> Integer\nend\n`)));
  }

  const t0 = performance.now();
  const fds = [
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new PreopenDirectory("/", new Map()),
    new PreopenDirectory("/mnt", contents),
  ];
  const wasi = new WASI([], [], fds, { debug: false });
  const { vm: vm3 } = await RubyVM.instantiateModule({ module: rubyModule, wasip1: wasi });
  const initMs = performance.now() - t0;

  const t1 = performance.now();
  const result = vm3.eval(`
r = []
r << "Dir.entries('/mnt').size: #{Dir.entries('/mnt').size}"
r << "File.read('/mnt/hello.rbs'): #{File.read('/mnt/hello.rbs').inspect}"
$LOAD_PATH.unshift('/mnt')
begin
  require 'injected'
  r << "require 'injected': ok -> #{Injected::MESSAGE}"
rescue Exception => e
  r << "require 'injected': #{e.class}: #{e.message}"
end
r << "Dir.glob('/mnt/**/*.rbs').size: #{Dir.glob('/mnt/**/*.rbs').size}"
r.join("\\n")
`).toString();
  const evalMs = performance.now() - t1;

  return { extraFileCount, initMs, evalMs, result };
}

self.onmessage = async (event) => {
  const { type, id, code } = event.data;

  try {
    if (type === "boot") {
      if (event.data.wasmUrl) wasmUrl = event.data.wasmUrl;
      const timings = await boot();
      self.postMessage({ type: "boot", ok: true, timings });
      return;
    }

    if (type === "mount-test") {
      const timings = await mountTest(event.data.extraFileCount || 0);
      self.postMessage({ type: "mount-test", id, ok: true, timings });
      return;
    }

    if (type === "second-vm") {
      const timings = await secondVM();
      self.postMessage({ type: "second-vm", id, ok: true, timings });
      return;
    }

    if (type === "eval") {
      const t0 = performance.now();
      const result = vm.eval(code);
      const text = result.toString();
      const ms = performance.now() - t0;
      self.postMessage({ type: "eval", id, ok: true, result: text, ms });
      return;
    }

    self.postMessage({ type, id, ok: false, error: `unknown message type: ${type}` });
  } catch (err) {
    self.postMessage({ type, id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
