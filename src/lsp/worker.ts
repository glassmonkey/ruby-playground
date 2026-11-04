import { RubyVM } from "@ruby/wasm-wasi";
import {
  ConsoleStdout,
  Directory,
  File,
  Inode,
  OpenFile,
  PreopenDirectory,
  WASI,
} from "@bjorn3/browser_wasi_shim";
import type { LspRubyVersion } from "./versions";

type WorkerRequest = {
  type: "request";
  token: number;
  message: { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };
};

type WorkerMessage = WorkerRequest | { type: "initialize"; target: string };

const coreVersions: Record<LspRubyVersion, string> = {
  "3.3": "3.4.0",
  "4.0": "3.10.0",
};
let queue = Promise.resolve();
let server: { call: (method: string, ...args: string[]) => { toString(): string } };
let rubyVm: { eval: (source: string) => { toString(): string } };
let stage = "startup";

let configured = false;
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const request = event.data;
  if (request?.type === "initialize") {
    if (configured) return;
    configured = true;
    const target = request.target as LspRubyVersion;
    if (!(target in coreVersions)) {
      const error = new Error("Unsupported Ruby analysis version.");
      self.postMessage({ type: "fatal", error: error.message });
      rejectInitialized(error);
      return;
    }
    void initialize(target).catch((error: unknown) => {
      const reason = error instanceof Error ? error : new Error(String(error));
      self.postMessage({ type: "fatal", stage, error: reason.message });
      rejectInitialized(reason);
    });
    return;
  }
  if (request?.type !== "request") return;
  queue = queue.then(async () => {
    await ready;
    const started = performance.now();
    try {
      const json = JSON.stringify(request.message);
      const rubyArgument = rubyVm.eval(rubyString(json));
      const rubyResult = server
        .call("dispatch", rubyArgument as unknown as string)
        .toString();
      self.postMessage({
        type: "response",
        token: request.token,
        responses: JSON.parse(rubyResult),
        elapsedMs: performance.now() - started,
      });
    } catch (error) {
      self.postMessage({
        type: "response",
        token: request.token,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }).catch((error: unknown) => {
    self.postMessage({
      type: "response",
      token: request.token,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

let resolveInitialized!: () => void;
let rejectInitialized!: (error: unknown) => void;
const initializeReady = new Promise<void>((resolve, reject) => {
  resolveInitialized = resolve;
  rejectInitialized = reject;
});
const ready = initializeReady;

async function initialize(version: LspRubyVersion): Promise<void> {
  const started = performance.now();
  stage = "download";
  const root = new URL(`${import.meta.env.BASE_URL}lsp/`, self.location.origin);
  const manifestResponse = await fetch(new URL("manifest.json", root), {
    cache: "no-cache",
  });
  if (!manifestResponse.ok)
    throw new Error(`Ruby completion manifest download failed (${manifestResponse.status}).`);
  const manifest = (await manifestResponse.json()) as LspManifest;
  const asset = (path: string) => {
    const entry = manifest.files[path];
    if (!entry) throw new Error(`Ruby completion asset ${path} is not in its manifest.`);
    const compressed = Boolean(entry.gzipSha256);
    const url = new URL(compressed ? `${path}.gz` : path, root);
    url.searchParams.set("sha256", compressed ? entry.gzipSha256! : entry.sha256);
    return fetch(url, { cache: "force-cache" });
  };
  const [wasmResponse, adapterResponse, versionAdapterResponse, coreResponse] =
    await Promise.all([
      asset("ruby-lsp-analysis.wasm"),
      asset("analysis_server.rb"),
      asset("versioned/adapter.rb"),
      asset(`versioned/core-${version}.json`),
    ]);
  const responses = [wasmResponse, adapterResponse, versionAdapterResponse, coreResponse];
  if (responses.some((response) => !response.ok))
    throw new Error("Ruby completion assets could not be downloaded.");
  const [adapter, versionAdapter] = await Promise.all([
    adapterResponse.text(),
    versionAdapterResponse.text(),
  ]);
  const [wasmBytes, core] = await Promise.all([
    readAssetBytes(wasmResponse, manifest.files["ruby-lsp-analysis.wasm"]),
    readAssetJson<Record<string, string>>(
      coreResponse,
      manifest.files[`versioned/core-${version}.json`],
    ),
  ]);
  await verifyAsset(
    new TextEncoder().encode(adapter),
    manifest.files["analysis_server.rb"],
  );
  await verifyAsset(
    new TextEncoder().encode(versionAdapter),
    manifest.files["versioned/adapter.rb"],
  );
  stage = "compile";
  const module = await WebAssembly.compile(wasmBytes);
  const rootEntries = new Map<string, Inode>();
  rootEntries.set("versioned-core", fileTree(core));
  const stdout = new ConsoleStdout(() => {});
  const stderr = new ConsoleStdout(() => {});
  const wasi = new WASI(
    [],
    [],
    [new OpenFile(new File([])), stdout, stderr, new PreopenDirectory("/", rootEntries)],
  );
  stage = "Ruby LSP initialization";
  ({ vm: rubyVm } = await RubyVM.instantiateModule({ module, wasip1: wasi }));
  rubyVm.eval('require "/bundle/setup"');
  rubyVm.eval(adapter);
  rubyVm.eval(versionAdapter);
  server = rubyVm.eval(
    `VersionedAnalysisServer.new(${rubyString(version)}, "/versioned-core")`,
  ) as typeof server;
  const wasmHash = manifest.files["ruby-lsp-analysis.wasm"].sha256;
  if (wasmBytes.byteLength !== manifest.files["ruby-lsp-analysis.wasm"].bytes)
    throw new Error("Ruby completion WASM size did not match its manifest.");
  self.postMessage({
    type: "ready",
    version,
    coreVersion: coreVersions[version],
    wasmSha256: wasmHash,
    timings: { initializationMs: performance.now() - started },
  });
  resolveInitialized();
}

function fileTree(files: Record<string, string>): Directory {
  const root = new Map<string, Inode>();
  for (const [path, contents] of Object.entries(files)) {
    const components = path.split("/");
    const name = components.pop();
    if (!name || components.some((component) => !component || component === "." || component === ".."))
      throw new Error("Invalid path in Ruby completion core.");
    let entries: Map<string, Inode> = root;
    for (const component of components) {
      let directory = entries.get(component);
      if (!directory) {
        directory = new Directory(new Map());
        entries.set(component, directory);
      }
      if (!(directory instanceof Directory))
        throw new Error("Invalid Ruby completion core directory.");
      entries = directory.contents;
    }
    if (entries.has(name)) throw new Error("Duplicate Ruby completion core path.");
    entries.set(name, new File(new TextEncoder().encode(contents)));
  }
  return new Directory(root);
}

async function verifyAsset(
  bytes: ArrayBuffer | Uint8Array,
  expected: { bytes: number; sha256: string | undefined } | undefined,
): Promise<void> {
  if (!expected || !expected.sha256)
    throw new Error("Ruby completion asset is missing its manifest entry.");
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength !== expected.bytes)
    throw new Error("Ruby completion asset size did not match its manifest.");
  const digest = await crypto.subtle.digest("SHA-256", data);
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expected.sha256)
    throw new Error("Ruby completion asset hash did not match its manifest.");
}

async function readAssetJson<T>(
  response: Response,
  entry: AssetManifestEntry | undefined,
): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readAssetBytes(response, entry))) as T;
}

async function readAssetBytes(
  response: Response,
  entry: AssetManifestEntry | undefined,
): Promise<ArrayBuffer> {
  if (!entry) throw new Error("Ruby completion asset is missing its manifest entry.");
  const body = await response.arrayBuffer();
  const bytes = new Uint8Array(body);
  const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
  let decoded = body;
  if (compressed) {
    await verifyAsset(body, {
      bytes: entry.gzipBytes ?? 0,
      sha256: entry.gzipSha256,
    });
    decoded = await new Response(
      new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
  }
  await verifyAsset(decoded, { bytes: entry.bytes, sha256: entry.sha256 });
  return decoded;
}

function rubyString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

type AssetManifestEntry = {
  bytes: number;
  sha256: string;
  gzipBytes?: number;
  gzipSha256?: string;
};

type LspManifest = { files: Record<string, AssetManifestEntry> };
