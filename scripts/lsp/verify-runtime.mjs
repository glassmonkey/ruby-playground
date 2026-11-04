import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { RubyVM } from "@ruby/wasm-wasi";
import {
  ConsoleStdout,
  Directory,
  File,
  OpenFile,
  PreopenDirectory,
  WASI,
} from "@bjorn3/browser_wasi_shim";

const assets = new URL("../../assets/lsp/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", assets), "utf8"));
const wasm = await assetBytes("ruby-lsp-analysis.wasm");
const adapter = new TextDecoder().decode(await assetBytes("analysis_server.rb"));
const versionAdapter = new TextDecoder().decode(await assetBytes("versioned/adapter.rb"));
const started = performance.now();
const module = await WebAssembly.compile(wasm);
const metrics = { wasmBytes: wasm.byteLength, boots: [], completions: [] };

for (const version of ["3.3", "4.0", "3.3"]) {
  const bootStarted = performance.now();
  const core = JSON.parse(
    new TextDecoder().decode(await assetBytes(`versioned/core-${version}.json`)),
  );
  const wasi = new WASI([], [], [
    new OpenFile(new File([])),
    new ConsoleStdout(() => {}),
    new ConsoleStdout(() => {}),
    new PreopenDirectory("/", new Map([["versioned-core", makeTree(core)]])),
  ]);
  const { vm } = await RubyVM.instantiateModule({ module, wasip1: wasi });
  vm.eval('require "/bundle/setup"');
  vm.eval(adapter);
  vm.eval(versionAdapter);
  const server = vm.eval(
    `VersionedAnalysisServer.new(${rubyString(version)}, "/versioned-core")`,
  );
  metrics.boots.push({ version, ms: performance.now() - bootStarted });
  const rpc = createRpc(server, vm);
  const uri = "file:///playground/main.rb";
  let documentVersion = 0;
  await rpc("initialize", {
    processId: null,
    rootUri: "file:///playground",
    capabilities: { general: { positionEncodings: ["utf-16"] } },
    initializationOptions: {
      enabledFeatures: ["completion"],
      formatter: "none",
      linters: [],
    },
  });
  await rpc("initialized", {});
  await rpc("textDocument/didOpen", {
    textDocument: { uri, languageId: "ruby", version: ++documentVersion, text: "" },
  });

  const cases = [
    {
      text: '[1,2].rf',
      label: "rfind",
      present: version === "4.0",
      editStart: { line: 0, character: 6 },
    },
    {
      text: "Ractor.yi",
      label: "yield",
      present: version === "3.3",
      editStart: { line: 0, character: 7 },
    },
    {
      text: "Fiber.new.rai",
      label: "raise",
      present: true,
      editStart: { line: 0, character: 10 },
    },
    {
      text: "greeting = \"hi\"\ngree",
      label: "greeting",
      present: true,
      editStart: { line: 1, character: 0 },
    },
    {
      text: '"hello".upc',
      label: "upcase",
      present: true,
      editStart: { line: 0, character: 8 },
    },
    {
      text: 'puts "Ruby"\nput',
      label: "puts",
      present: true,
      editStart: { line: 1, character: 0 },
    },
    {
      text: '名前 = "Ruby"\n名',
      label: "名前",
      present: true,
      editStart: { line: 1, character: 0 },
    },
    {
      text: 'class Mine; def rfind; 42; end; end; Mine.new.rf',
      label: "rfind",
      present: true,
      editStart: { line: 0, character: 46 },
    },
    {
      text: "unknown_method_zz",
      label: "upcase",
      present: false,
      editStart: { line: 0, character: 0 },
    },
  ];

  for (const testCase of cases) {
    const text = testCase.text;
    await rpc("textDocument/didChange", {
      textDocument: { uri, version: ++documentVersion },
      contentChanges: [{ text }],
    });
    const completionStarted = performance.now();
    let list;
    try {
      list = await rpc("textDocument/completion", {
        textDocument: { uri },
        position: endPosition(text),
      });
    } catch (error) {
      throw new Error(`${version}: completion failed for ${JSON.stringify(text)}`, { cause: error });
    }
    const items = Array.isArray(list) ? list : list?.items ?? [];
    const item = items.find(({ label }) => label === testCase.label);
    assert.equal(Boolean(item), testCase.present, `${version}: ${text}`);
    if (item) {
      assert.ok(item.textEdit, `${version}: ${text} omitted textEdit`);
      assert.equal(item.textEdit.newText, testCase.label);
      assert.deepEqual(item.textEdit.range.start, testCase.editStart);
      const expectedEnd = text.includes("名前")
        ? { line: 1, character: 3 }
        : endPosition(text);
      assert.deepEqual(item.textEdit.range.end, expectedEnd, `${version}: ${text}`);
      const startOffset = offsetAt(text, item.textEdit.range.start);
      const endOffset = offsetAt(text, item.textEdit.range.end);
      const inserted =
        text.slice(0, startOffset) + item.textEdit.newText + text.slice(endOffset);
      assert.equal(inserted, text.slice(0, startOffset) + testCase.label);
    }
    metrics.completions.push({
      version,
      ms: performance.now() - completionStarted,
      label: testCase.label,
      candidate: Boolean(item),
    });
  }

  const signatureSource = "Fiber.new.raise(nil)";
  await rpc("textDocument/didChange", {
    textDocument: { uri, version: ++documentVersion },
    contentChanges: [{ text: signatureSource }],
  });
  const signatureResult = await rpc("textDocument/signatureHelp", {
    textDocument: { uri },
    position: { line: 0, character: signatureSource.indexOf(")") },
  });
  const signatureLabel = signatureResult?.signatures?.[0]?.label ?? "";
  assert.equal(
    String(signatureLabel).includes("cause"),
    version === "4.0",
    `${version}: Fiber#raise signature was ${signatureLabel}`,
  );
  metrics.signatures = metrics.signatures ?? {};
  metrics.signatures[version] = signatureLabel;

  const syntaxErrors = vm.eval(
    `PlaygroundRubyVersion.with(${rubyString(version)}, "/versioned-core") { Prism.parse(${rubyString("if true\n && true\n  1\nend")}).errors.map(&:message) }`,
  );
  assert.equal(
    syntaxErrors.toString() === "[]",
    version === "4.0",
    `${version} syntax target was incorrect: ${syntaxErrors}`,
  );
}

metrics.totalMs = performance.now() - started;
console.log(JSON.stringify({ result: "PASS", ...metrics }, null, 2));

function createRpc(server, vm) {
  let id = 0;
  return async (method, params) => {
    const request = { jsonrpc: "2.0", method, params };
    const notifications = new Set([
      "initialized",
      "textDocument/didOpen",
      "textDocument/didChange",
      "textDocument/didClose",
    ]);
    if (!notifications.has(method)) request.id = ++id;
    const response = JSON.parse(
      server.call("dispatch", vm.eval(rubyString(JSON.stringify(request)))).toString(),
    );
    const entry = response.find((message) => message.id === request.id);
    if (entry?.error) throw new Error(JSON.stringify(entry.error));
    return entry?.result;
  };
}

function endPosition(text) {
  const lines = text.split("\n");
  return { line: lines.length - 1, character: lines.at(-1).length };
}

function offsetAt(text, position) {
  return text
    .split("\n")
    .slice(0, position.line)
    .reduce((length, line) => length + line.length + 1, 0) + position.character;
}

function makeTree(files) {
  const root = new Map();
  for (const [path, contents] of Object.entries(files)) {
    const components = path.split("/");
    const name = components.pop();
    let entries = root;
    for (const part of components) {
      if (!entries.has(part)) entries.set(part, new Directory(new Map()));
      entries = entries.get(part).contents;
    }
    entries.set(name, new File(new TextEncoder().encode(contents)));
  }
  return new Directory(root);
}

async function assetBytes(path) {
  const entry = manifest.files[path];
  assert.ok(entry, `missing manifest entry for ${path}`);
  if (entry.gzipSha256) {
    const gzip = await readFile(new URL(`${path}.gz`, assets));
    assert.equal(gzip.byteLength, entry.gzipBytes, `${path} gzip size mismatch`);
    assert.equal(
      createHash("sha256").update(gzip).digest("hex"),
      entry.gzipSha256,
      `${path} gzip hash mismatch`,
    );
    const bytes = gunzipSync(gzip);
    assert.equal(bytes.byteLength, entry.bytes, `${path} size mismatch`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
      `${path} hash mismatch`,
    );
    return bytes;
  }
  const bytes = await readFile(new URL(path, assets));
  assert.equal(bytes.byteLength, entry.bytes, `${path} size mismatch`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    entry.sha256,
    `${path} hash mismatch`,
  );
  return bytes;
}

function rubyString(value) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
