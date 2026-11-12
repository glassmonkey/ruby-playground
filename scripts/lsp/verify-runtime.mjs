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
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", assets), "utf8"),
);
assert.deepEqual(manifest.typeprof, {
  version: "0.33.2",
  sha256: "aa777c684d578ed27dc3e5d4bc4104c9eb5a76eedf7f5dd3366d571eaa6ca7c3",
  source: "https://rubygems.org/downloads/typeprof-0.33.2.gem",
  license: "MIT",
  runtimeDependencies: [
    { name: "prism", requirement: ">= 1.4.0" },
    { name: "rbs", requirement: ">= 3.6.0" },
  ],
});
const wasm = await assetBytes("typeprof-analysis.wasm");
const adapter = new TextDecoder().decode(
  await assetBytes("analysis_server.rb"),
);
const versionAdapter = new TextDecoder().decode(
  await assetBytes("versioned/adapter.rb"),
);
const module = await WebAssembly.compile(wasm);
const metrics = {
  wasmBytes: wasm.byteLength,
  wasmSha256: manifest.files["typeprof-analysis.wasm"].sha256,
  typeprof: manifest.typeprof,
  boots: [],
  checks: [],
};

for (const version of ["3.3", "4.0", "3.3"]) {
  const corePath = `versioned/core-${version}.json`;
  const core = JSON.parse(new TextDecoder().decode(await assetBytes(corePath)));
  const coreBytes = await assetBytes(corePath);
  const wasi = new WASI(
    [],
    [],
    [
      new OpenFile(new File([])),
      new ConsoleStdout(() => {}),
      new ConsoleStdout(() => {}),
      new PreopenDirectory("/", new Map([["versioned-core", makeTree(core)]])),
    ],
  );
  const { vm } = await RubyVM.instantiateModule({ module, wasip1: wasi });
  vm.eval('require "/bundle/setup"');
  vm.eval(versionAdapter);
  vm.eval(adapter);
  const server = vm.eval(
    `PlaygroundTypeProf.new(${rubyString(version)}, "/versioned-core")`,
  );
  const rpc = createRpc(server, vm);
  const uri = "inmemory://model/1";
  let documentVersion = 0;
  const coreSha256 = createHash("sha256").update(coreBytes).digest("hex");
  assert.equal(coreSha256, manifest.files[corePath].sha256);
  metrics.boots.push({
    version,
    coreSha256,
    coreFiles: Object.keys(core).length,
  });

  const initialize = await rpc("initialize", {
    processId: null,
    rootUri: "file:///playground",
    workspaceFolders: [{ uri: "file:///playground", name: "Ruby Playground" }],
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      textDocument: {
        completion: {
          completionItem: {
            resolveSupport: { properties: ["detail", "documentation"] },
          },
        },
      },
    },
  });
  assert.equal(initialize.serverInfo.name, "typeprof");
  assert.equal(initialize.serverInfo.version, "0.33.2");
  assert.equal(initialize.capabilities.positionEncoding, "utf-16");
  assert.notEqual(
    initialize.capabilities.completionProvider.resolveProvider,
    true,
  );
  await rpc("initialized", {});
  await rpc("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "ruby",
      version: ++documentVersion,
      text: "",
    },
  });

  const cases = [
    {
      name: "literal-upcase",
      text: '"hello".upc',
      position: { line: 0, character: 11 },
      label: "upcase",
      present: true,
      editStart: { line: 0, character: 8 },
      detailIncludes: "String#upcase",
    },
    {
      name: "return-type",
      text: 'def greeting; "hi"; end\ngreeting.',
      position: { line: 1, character: 9 },
      label: "upcase",
      present: true,
    },
    {
      name: "array-first",
      text: 'names = ["hello"]\nitem = names.first\nitem.',
      position: { line: 2, character: 5 },
      label: "upcase",
      present: true,
    },
    {
      name: "map-block",
      text: 'names = ["hello"]\nnames.map { |name| name. }',
      position: { line: 1, character: 24 },
      label: "upcase",
      present: true,
    },
    {
      name: "custom-method",
      text: 'class Greeter; def salutation; "hi"; end; end\nGreeter.new.salu',
      position: { line: 1, character: 16 },
      label: "salutation",
      present: true,
      detailIncludes: "Greeter#salutation",
    },
    {
      name: "local-variable",
      text: 'greeting = "hi"\ngree',
      position: { line: 1, character: 4 },
      label: "greeting",
      present: true,
    },
    {
      name: "top-level-puts-prefix",
      text: 'puts "hello"\nput',
      position: { line: 1, character: 3 },
      label: "puts",
      present: true,
    },
    {
      name: "manager-inmemory-return-prefix",
      text: 'def greeting; "hello"; end\nputs greeting.upc',
      position: { line: 1, character: 17 },
      label: "upcase",
      present: true,
    },
    {
      name: "unknown-receiver",
      text: "unknown_receiver.",
      position: { line: 0, character: 17 },
      label: "upcase",
      present: false,
    },
    {
      name: "array-rfind",
      text: "values = [1, 2]\nvalues.rfi",
      position: { line: 1, character: 10 },
      label: "rfind",
      present: version === "4.0",
    },
    {
      name: "ractor-yield",
      text: "Ractor.yi",
      position: { line: 0, character: 9 },
      label: "yield",
      present: version === "3.3",
    },
    {
      name: "fiber-raise",
      text: "Fiber.new.rai",
      position: { line: 0, character: 13 },
      label: "raise",
      present: true,
      detailHasCause: version === "4.0",
    },
    {
      name: "japanese-utf16",
      text: '名前 = "hello"\n名前.upc',
      position: { line: 1, character: 6 },
      label: "upcase",
      present: true,
      editStart: { line: 1, character: 3 },
    },
    {
      name: "emoji-suffix-utf16",
      text: 'marker = "😀"; puts "hi".upc + "!"',
      position: { line: 0, character: 28 },
      label: "upcase",
      present: true,
      editStart: { line: 0, character: 25 },
    },
  ];

  for (const testCase of cases) {
    await changeDocument(rpc, uri, ++documentVersion, testCase.text);
    const list = await rpc("textDocument/completion", {
      textDocument: { uri },
      position: testCase.position,
    });
    const items = list?.items ?? [];
    const item = items.find(({ label }) => label === testCase.label);
    assert.equal(
      Boolean(item),
      testCase.present,
      `${version}: ${testCase.name}`,
    );
    if (item) {
      assert.ok(
        item.textEdit,
        `${version}: ${testCase.name} omitted textEdit: ${JSON.stringify(item)}`,
      );
      assert.equal(item.textEdit.newText, testCase.label);
      assert.deepEqual(
        item.textEdit.range.start,
        testCase.editStart ?? wordStart(testCase.text, testCase.position),
      );
      assert.deepEqual(item.textEdit.range.end, testCase.position);
      if (testCase.detailIncludes)
        assert.ok(
          item.detail.includes(testCase.detailIncludes),
          `${version}: ${item.detail}`,
        );
      if (testCase.detailHasCause !== undefined)
        assert.equal(
          item.detail.includes("cause:"),
          testCase.detailHasCause,
          `${version}: ${item.detail}`,
        );
      const inserted = applyTextEdit(testCase.text, item.textEdit);
      if (testCase.name === "emoji-suffix-utf16")
        assert.equal(inserted, 'marker = "😀"; puts "hi".upcase + "!"');
    }
    metrics.checks.push({
      version,
      name: testCase.name,
      passed: true,
      candidate: Boolean(item),
    });
  }

  await changeDocument(rpc, uri, ++documentVersion, 'value = "hello"\nvalue.');
  const stringItems = await completion(rpc, uri, { line: 1, character: 6 });
  await changeDocument(rpc, uri, ++documentVersion, "value = 42\nvalue.");
  const integerItems = await completion(rpc, uri, { line: 1, character: 6 });
  assert.ok(stringItems.some(({ label }) => label === "upcase"));
  assert.ok(!integerItems.some(({ label }) => label === "upcase"));
  assert.ok(integerItems.some(({ label }) => label === "digits"));
  metrics.checks.push({ version, name: "document-type-change", passed: true });

  await changeDocument(
    rpc,
    uri,
    ++documentVersion,
    'emoji = "😀"; value = "hello"; value.',
  );
  await changeDocument(
    rpc,
    uri,
    ++documentVersion,
    'emoji = "😀"; value = 42; value.',
  );
  const emojiUpdateItems = await completion(rpc, uri, {
    line: 0,
    character: 32,
  });
  assert.ok(emojiUpdateItems.some(({ label }) => label === "digits"));
  assert.ok(!emojiUpdateItems.some(({ label }) => label === "upcase"));
  metrics.checks.push({
    version,
    name: "single-full-document-update-after-emoji",
    passed: true,
  });

  await assert.rejects(
    rpc("textDocument/completion", {
      textDocument: { uri: "file:///outside/main.rb" },
      position: { line: 0, character: 11 },
    }),
    /outside the analysis workspace/,
  );

  const nextModelUri = "inmemory://model/2";
  await rpc("textDocument/didClose", { textDocument: { uri } });
  await rpc("textDocument/didOpen", {
    textDocument: {
      uri: nextModelUri,
      languageId: "ruby",
      version: 1,
      text: '"hello".upc',
    },
  });
  await assert.rejects(
    rpc("textDocument/completion", {
      textDocument: { uri },
      position: { line: 0, character: 11 },
    }),
    /not the active editor model/,
  );
  const nextModelItems = await completion(rpc, nextModelUri, {
    line: 0,
    character: 11,
  });
  assert.ok(nextModelItems.some(({ label }) => label === "upcase"));
  await rpc("textDocument/didClose", {
    textDocument: { uri: nextModelUri },
  });
  await rpc("textDocument/didOpen", {
    textDocument: {
      uri: "file:///playground/main.rb",
      languageId: "ruby",
      version: 1,
      text: '"hello".upc',
    },
  });
  const fileUriItems = await completion(rpc, "file:///playground/main.rb", {
    line: 0,
    character: 11,
  });
  assert.ok(fileUriItems.some(({ label }) => label === "upcase"));
  await rpc("textDocument/didClose", {
    textDocument: { uri: "file:///playground/main.rb" },
  });

  const syntaxErrors = vm.eval(
    `PlaygroundRubyVersion.with(${rubyString(version)}, "/versioned-core") { Prism.parse(${rubyString("if true\n && true\n  1\nend")}).errors.map(&:message) }`,
  );
  assert.equal(syntaxErrors.toString() === "[]", version === "4.0");
}

assert.deepEqual(
  metrics.boots.map(({ coreSha256 }) => coreSha256),
  [
    manifest.files["versioned/core-3.3.json"].sha256,
    manifest.files["versioned/core-4.0.json"].sha256,
    manifest.files["versioned/core-3.3.json"].sha256,
  ],
);
console.log(JSON.stringify({ result: "PASS", ...metrics }, null, 2));

async function changeDocument(rpc, uri, version, text) {
  return rpc("textDocument/didChange", {
    textDocument: { uri, version },
    contentChanges: [{ text }],
  });
}

async function completion(rpc, uri, position) {
  const result = await rpc("textDocument/completion", {
    textDocument: { uri },
    position,
  });
  return result?.items ?? [];
}

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
      server
        .call("dispatch", vm.eval(rubyString(JSON.stringify(request))))
        .toString(),
    );
    const entry = response.find((message) => message.id === request.id);
    if (entry?.error) throw new Error(JSON.stringify(entry.error));
    return entry?.result;
  };
}

function wordStart(text, position) {
  const line = text.split("\n")[position.line];
  const prefix =
    line.slice(0, position.character).match(/[\p{L}\p{N}_!?=]*$/u)?.[0] ?? "";
  return { line: position.line, character: position.character - prefix.length };
}

function applyTextEdit(text, edit) {
  const lines = text.split("\n");
  const line = lines[edit.range.start.line];
  const start = edit.range.start.character;
  const end = edit.range.end.character;
  lines[edit.range.start.line] =
    line.slice(0, start) + edit.newText + line.slice(end);
  return lines.join("\n");
}

function makeTree(files) {
  const root = new Map();
  for (const [path, contents] of Object.entries(files)) {
    const components = path.split("/");
    const name = components.pop();
    let entries = root;
    for (const component of components) {
      let directory = entries.get(component);
      if (!directory) {
        directory = new Directory(new Map());
        entries.set(component, directory);
      }
      entries = directory.contents;
    }
    entries.set(name, new File(new TextEncoder().encode(contents)));
  }
  return new Directory(root);
}

async function assetBytes(path) {
  const entry = manifest.files[path];
  assert.ok(entry, `missing manifest entry: ${path}`);
  const relativePath = entry.gzipSha256 ? `${path}.gz` : path;
  const bytes = await readFile(new URL(relativePath, assets));
  if (entry.gzipSha256) {
    assert.equal(bytes.byteLength, entry.gzipBytes, `${path} gzip size`);
    assert.equal(sha256(bytes), entry.gzipSha256, `${path} gzip hash`);
  }
  const data = entry.gzipSha256 ? gunzipSync(bytes) : bytes;
  assert.equal(data.byteLength, entry.bytes, `${path} size`);
  assert.equal(sha256(data), entry.sha256, `${path} hash`);
  return data;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rubyString(value) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
