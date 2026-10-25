import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BASE_PATH,
  inspectLive,
  inventory,
  retainAssets,
  safeAssetPath,
  sha256,
  verifyCurrent,
} from "./pages-assets.mjs";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const OLDER = "c".repeat(40);
const nativeAssets = {
  "index-abcdefgh.js": 'import("./lazy-12345678.js")',
  "lazy-12345678.js": 'new Worker("./worker-abcdefgh.js")',
  "worker-abcdefgh.js": 'fetch("./ruby-12345678.wasm")',
  "ruby-12345678.wasm": "wasm bytes",
  "editor-abcdefgh.css": "body{}",
};
const sourceHtml =
  '<html><head></head><body><script type="module" src="/ruby-playground/index-abcdefgh.js"></script></body></html>';
const liveHtml = sourceHtml.replace(
  "<head>",
  `<head><meta name="release-source" content="${OLD}"><meta name="release-stage" content="production">`,
);
const liveInfo = () => ({
  source_sha: OLD,
  stage: "production",
  base_path: BASE_PATH,
  wasm: [
    {
      url: `${BASE_PATH}ruby-12345678.wasm`,
      bytes: Buffer.byteLength(nativeAssets["ruby-12345678.wasm"]),
      sha256: sha256(nativeAssets["ruby-12345678.wasm"]),
    },
  ],
});
const asset = (name, bytes, source = OLD) => ({
  path: name,
  bytes: Buffer.byteLength(bytes),
  sha256: sha256(bytes),
  source_shas: [source],
});
function server(overrides = {}) {
  const data = {
    "": liveHtml,
    "release-info.json": JSON.stringify(liveInfo()),
    ...nativeAssets,
    ...overrides,
  };
  const requests = [];
  const fetcher = async (url, options) => {
    assert.equal(url.origin, "https://glassmonkey.github.io");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    const key = url.pathname.slice(BASE_PATH.length);
    requests.push(key);
    return data[key] === undefined
      ? new Response("missing", { status: 404 })
      : new Response(data[key]);
  };
  return { data, requests, fetcher };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pages-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidateDir = path.join(root, "candidate");
  const baselineDir = path.join(root, "baseline");
  const staticDir = path.join(root, "static");
  for (const dir of [candidateDir, baselineDir, staticDir]) await mkdir(dir);
  for (const [name, value] of Object.entries(nativeAssets))
    await writeFile(path.join(baselineDir, name), value);
  await writeFile(path.join(baselineDir, "index.html"), sourceHtml);
  await writeFile(path.join(candidateDir, "index-ijklmnop.js"), "new app");
  await writeFile(path.join(candidateDir, "ruby-87654321.wasm"), "new wasm");
  await writeFile(
    path.join(candidateDir, "index.html"),
    "candidate HTML must survive",
  );
  await writeFile(
    path.join(candidateDir, "release-info.json"),
    JSON.stringify({
      source_sha: NEW,
      stage: "production",
      base_path: BASE_PATH,
    }),
  );
  return {
    candidateDir,
    baselineDir,
    candidateStaticDir: staticDir,
    baselineStaticDir: staticDir,
    sourceSha: NEW,
  };
}

test("retains full generated lazy/worker/WASM/CSS closure and never overwrites candidate HTML", async (t) => {
  const dirs = await fixture(t);
  const host = server();
  const snapshot = await inspectLive({
    expectedCurrentSha: OLD,
    fetcher: host.fetcher,
  });
  const manifest = await retainAssets({
    ...dirs,
    snapshot,
    fetcher: host.fetcher,
  });
  assert.equal(
    await readFile(path.join(dirs.candidateDir, "index.html"), "utf8"),
    "candidate HTML must survive",
  );
  for (const [name, bytes] of Object.entries(nativeAssets)) {
    assert.equal(
      await readFile(path.join(dirs.candidateDir, name), "utf8"),
      bytes,
    );
    assert.ok(
      manifest.assets.find(
        (item) =>
          item.path === name &&
          item.sha256 === sha256(bytes) &&
          item.source_shas.includes(OLD),
      ),
    );
  }
  const published = JSON.parse(
    await readFile(path.join(dirs.candidateDir, "release-info.json")),
  );
  assert.equal(published.source_sha, NEW);
  assert.equal(
    published.asset_manifest.sha256,
    sha256(
      await readFile(path.join(dirs.candidateDir, "asset-retention.json")),
    ),
  );
});

test("carries older retained assets forward and records their original sources", async (t) => {
  const dirs = await fixture(t);
  const olderName = "older-worker-12345678.js";
  const manifest = {
    schema_version: 1,
    source_sha: OLD,
    base_path: BASE_PATH,
    assets: [
      ...Object.entries(nativeAssets).map(([name, bytes]) =>
        asset(name, bytes),
      ),
      asset(olderName, "older", OLDER),
    ],
  };
  const bytes = JSON.stringify(manifest);
  const info = liveInfo();
  info.asset_manifest = {
    url: `${BASE_PATH}asset-retention.json`,
    bytes: Buffer.byteLength(bytes),
    sha256: sha256(bytes),
  };
  const host = server({
    "release-info.json": JSON.stringify(info),
    "asset-retention.json": bytes,
    [olderName]: "older",
  });
  const snapshot = await inspectLive({
    expectedCurrentSha: OLD,
    fetcher: host.fetcher,
  });
  const result = await retainAssets({
    ...dirs,
    snapshot,
    fetcher: host.fetcher,
  });
  assert.deepEqual(
    result.assets.find((item) => item.path === olderName).source_shas,
    [OLDER],
  );
  assert.equal(
    await readFile(path.join(dirs.candidateDir, olderName), "utf8"),
    "older",
  );
});

test("rejects missing, mismatched, or altered production SHA and preview after production", async () => {
  const host = server();
  await assert.rejects(
    inspectLive({ fetcher: host.fetcher }),
    /approved baseline/,
  );
  await assert.rejects(
    inspectLive({ expectedCurrentSha: NEW, fetcher: host.fetcher }),
    /approved baseline/,
  );
  await assert.rejects(
    inspectLive({
      expectedCurrentSha: OLD,
      firstProduction: true,
      fetcher: host.fetcher,
    }),
    /conflicts/,
  );
  await assert.rejects(
    inspectLive({ stage: "preview", fetcher: host.fetcher }),
    /preview is forbidden/,
  );
  host.data[""] = liveHtml.replace(OLD, NEW);
  await assert.rejects(
    inspectLive({ expectedCurrentSha: OLD, fetcher: host.fetcher }),
    /HTML\/source/,
  );
});

test("no baseline is allowed only on explicit first production, never on a broken existing deployment", async () => {
  const host = server({ "": undefined, "release-info.json": undefined });
  await assert.rejects(
    inspectLive({ fetcher: host.fetcher }),
    /explicitly confirmed first/,
  );
  assert.equal(
    (await inspectLive({ firstProduction: true, fetcher: host.fetcher }))
      .source_sha,
    null,
  );
  await assert.rejects(
    inspectLive({
      firstProduction: true,
      expectedCurrentSha: OLD,
      fetcher: host.fetcher,
    }),
    /baseline is missing/,
  );
  host.data[""] = liveHtml;
  await assert.rejects(
    inspectLive({ firstProduction: true, fetcher: host.fetcher }),
    /release HTML exists/,
  );
  host.data[""] = "<html>unknown app</html>";
  await assert.rejects(
    inspectLive({ firstProduction: true, fetcher: host.fetcher }),
    /Unknown root HTML/,
  );
});

test("refuses missing WASM hashes and missing/corrupt retained-asset manifests", async () => {
  const info = liveInfo();
  delete info.wasm[0].sha256;
  let host = server({ "release-info.json": JSON.stringify(info) });
  await assert.rejects(
    inspectLive({ expectedCurrentSha: OLD, fetcher: host.fetcher }),
    /SHA-256/,
  );
  const current = liveInfo();
  current.asset_manifest = {
    url: `${BASE_PATH}asset-retention.json`,
    bytes: 10,
    sha256: "0".repeat(64),
  };
  host = server({ "release-info.json": JSON.stringify(current) });
  await assert.rejects(
    inspectLive({ expectedCurrentSha: OLD, fetcher: host.fetcher }),
    /404/,
  );
  host.data["asset-retention.json"] = "corrupt";
  await assert.rejects(
    inspectLive({ expectedCurrentSha: OLD, fetcher: host.fetcher }),
    /hash\/length mismatch/,
  );
});

test("refuses missing SHA-256, unsafe paths, and duplicate paths inside a signed manifest", async () => {
  for (const bad of [
    { path: "bad-12345678.js", bytes: 2, source_shas: [OLD] },
    asset("../escape-12345678.js", "x"),
    asset("index.html", "x"),
    [asset("same-12345678.js", "x"), asset("same-12345678.js", "x")],
  ]) {
    const manifest = JSON.stringify({
      schema_version: 1,
      source_sha: OLD,
      base_path: BASE_PATH,
      assets: Array.isArray(bad) ? bad : [bad],
    });
    const info = liveInfo();
    info.asset_manifest = {
      url: `${BASE_PATH}asset-retention.json`,
      bytes: Buffer.byteLength(manifest),
      sha256: sha256(manifest),
    };
    const host = server({
      "release-info.json": JSON.stringify(info),
      "asset-retention.json": manifest,
    });
    await assert.rejects(
      inspectLive({ expectedCurrentSha: OLD, fetcher: host.fetcher }),
      /SHA-256|Unsafe asset path|filename hash|Duplicate/,
    );
  }
});

test("rejects path traversal, encoded paths, absolute URLs, reserved paths, and backslashes", () => {
  for (const value of [
    "../bad-12345678.js",
    "/bad-12345678.js",
    "a/../bad-12345678.js",
    "a//bad-12345678.js",
    "a\\bad-12345678.js",
    "%2e%2e/bad-12345678.js",
    "https://evil.example/a-12345678.js",
    "index.html",
    "release-info.json",
    "a/./bad-12345678.js",
  ])
    assert.throws(() => safeAssetPath(value));
  assert.equal(
    safeAssetPath("chunks/worker-1234_ab-.js"),
    "chunks/worker-1234_ab-.js",
  );
});

test("refuses rebuilt/live asset mismatch and missing assets", async (t) => {
  for (const override of ["corrupted", undefined]) {
    const dirs = await fixture(t);
    const host = server({ "worker-abcdefgh.js": override });
    const snapshot = await inspectLive({
      expectedCurrentSha: OLD,
      fetcher: host.fetcher,
    });
    await assert.rejects(
      retainAssets({ ...dirs, snapshot, fetcher: host.fetcher }),
      /hash\/length mismatch|404/,
    );
  }
});

test("refuses different bytes at the same hashed filename instead of overwriting", async (t) => {
  const dirs = await fixture(t);
  await writeFile(
    path.join(dirs.candidateDir, "index-abcdefgh.js"),
    "collision",
  );
  const host = server();
  const snapshot = await inspectLive({
    expectedCurrentSha: OLD,
    fetcher: host.fetcher,
  });
  await assert.rejects(
    retainAssets({ ...dirs, snapshot, fetcher: host.fetcher }),
    /path\/hash collision/,
  );
  assert.equal(
    await readFile(path.join(dirs.candidateDir, "index-abcdefgh.js"), "utf8"),
    "collision",
  );
});

test("refuses a rebuild whose entry HTML differs, even when all known assets exist", async (t) => {
  const dirs = await fixture(t);
  await writeFile(
    path.join(dirs.baselineDir, "index.html"),
    sourceHtml.replace("index-abcdefgh", "unknown-12345678"),
  );
  const host = server();
  const snapshot = await inspectLive({
    expectedCurrentSha: OLD,
    fetcher: host.fetcher,
  });
  await assert.rejects(
    retainAssets({ ...dirs, snapshot, fetcher: host.fetcher }),
    /asset closure is unproven/,
  );
});

test("current-production guard refuses source or HTML changes before deployment", async () => {
  const host = server();
  const snapshot = await inspectLive({
    expectedCurrentSha: OLD,
    fetcher: host.fetcher,
  });
  await verifyCurrent(snapshot, host.fetcher);
  host.data[""] += "<!-- changed -->";
  await assert.rejects(
    verifyCurrent(snapshot, host.fetcher),
    /changed since inspection/,
  );
  host.data[""] = liveHtml;
  host.data["release-info.json"] = JSON.stringify({
    ...liveInfo(),
    source_sha: NEW,
  });
  await assert.rejects(
    verifyCurrent(snapshot, host.fetcher),
    /approved baseline/,
  );
});

test("inventory refuses symlinks and unhashed executable resources", async (t) => {
  const dirs = await fixture(t);
  await symlink(
    path.join(dirs.baselineDir, "index-abcdefgh.js"),
    path.join(dirs.candidateDir, "linked-12345678.js"),
  );
  await assert.rejects(
    inventory(dirs.candidateDir, dirs.candidateStaticDir, NEW),
    /Symlinks/,
  );
  await rm(path.join(dirs.candidateDir, "linked-12345678.js"));
  await writeFile(
    path.join(dirs.candidateStaticDir, "legacy.js"),
    "unsafe mutable runtime",
  );
  await assert.rejects(
    inventory(dirs.candidateDir, dirs.candidateStaticDir, NEW),
    /Unversioned executable/,
  );
});
