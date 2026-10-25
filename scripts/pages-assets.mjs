// Fail closed: rebuilding trusted source inventories the entire Vite output,
// including lazy chunks and worker/WASM dependencies, without evaluating live JS.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORIGIN = "https://glassmonkey.github.io";
export const BASE_PATH = "/ruby-playground/";
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const HASHED_FILE = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function safeAssetPath(value) {
  requireThat(
    typeof value === "string" && /^[A-Za-z0-9_.+/-]+$/.test(value),
    `Unsafe asset path: ${value}`,
  );
  requireThat(
    !value.startsWith("/") &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
    `Unsafe asset path: ${value}`,
  );
  requireThat(
    HASHED_FILE.test(path.posix.basename(value)),
    `Asset has no immutable filename hash: ${value}`,
  );
  return value;
}

function assetRecord(value) {
  safeAssetPath(value.path);
  requireThat(
    Number.isSafeInteger(value.bytes) &&
      value.bytes > 0 &&
      value.bytes <= MAX_ASSET_BYTES,
    `Invalid byte length: ${value.path}`,
  );
  requireThat(
    typeof value.sha256 === "string" && DIGEST.test(value.sha256),
    `Missing or invalid SHA-256: ${value.path}`,
  );
  requireThat(
    Array.isArray(value.source_shas) &&
      value.source_shas.length > 0 &&
      value.source_shas.every((sha) => SHA.test(sha)),
    `Invalid asset source: ${value.path}`,
  );
  return value;
}

async function filesBelow(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), {
    withFileTypes: true,
  });
  const result = [];
  for (const entry of entries.sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    const relative = path.posix.join(prefix, entry.name);
    requireThat(
      !entry.isSymbolicLink(),
      `Symlinks are not allowed: ${relative}`,
    );
    if (entry.isDirectory()) result.push(...(await filesBelow(root, relative)));
    else {
      requireThat(entry.isFile(), `Unsupported file: ${relative}`);
      result.push(relative);
    }
  }
  return result;
}

export async function inventory(buildDir, staticDir, sourceSha) {
  requireThat(SHA.test(sourceSha), "Invalid inventory source SHA");
  const staticFiles = new Set(await filesBelow(staticDir));
  // Unhashed executable resources would need their own compatibility design.
  for (const file of staticFiles)
    requireThat(
      !/\.(?:js|mjs|css|wasm)$/i.test(file),
      `Unversioned executable asset requires review: ${file}`,
    );
  const assets = [];
  for (const file of await filesBelow(buildDir)) {
    if (
      file === "index.html" ||
      file === "release-info.json" ||
      file === "asset-retention.json" ||
      staticFiles.has(file)
    )
      continue;
    safeAssetPath(file);
    const bytes = await readFile(path.join(buildDir, file));
    assets.push(
      assetRecord({
        path: file,
        bytes: bytes.length,
        sha256: sha256(bytes),
        source_shas: [sourceSha],
      }),
    );
  }
  requireThat(
    assets.some((asset) => asset.path.endsWith(".js")) &&
      assets.some((asset) => asset.path.endsWith(".wasm")),
    "Build is missing JS or WASM assets",
  );
  return assets;
}

async function get(relative, fetcher, allow404 = false) {
  const url = new URL(relative, `${ORIGIN}${BASE_PATH}`);
  requireThat(
    url.origin === ORIGIN && url.pathname.startsWith(BASE_PATH),
    "Unexpected release URL",
  );
  // Request a fresh CDN representation; never execute downloaded source.
  url.searchParams.set(
    "pages-release-check",
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const response = await fetcher(url, {
    redirect: "error",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(120000),
  });
  if (allow404 && response.status === 404) return null;
  requireThat(
    response.status === 200,
    `Live fetch failed (${response.status}): ${url.pathname}`,
  );
  requireThat(
    !response.url || new URL(response.url).origin === ORIGIN,
    "Unexpected response origin",
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  requireThat(
    bytes.length <= MAX_ASSET_BYTES,
    `Live resource too large: ${url.pathname}`,
  );
  return bytes;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Invalid ${label} JSON`);
  }
}

function meta(html, name) {
  const found = [...html.matchAll(/<meta\s+[^>]*>/gi)].filter(([tag]) =>
    new RegExp(`\\bname=["']${name}["']`, "i").test(tag),
  );
  requireThat(found.length === 1, `Missing or duplicate HTML ${name} metadata`);
  return found[0][0].match(/\bcontent=["']([^"']*)["']/i)?.[1];
}

function checkManifest(manifest, sourceSha) {
  requireThat(
    manifest.schema_version === 1 &&
      manifest.source_sha === sourceSha &&
      manifest.base_path === BASE_PATH,
    "Asset manifest source/path mismatch",
  );
  requireThat(
    Array.isArray(manifest.assets) && manifest.assets.length > 0,
    "Missing manifest assets",
  );
  const seen = new Set();
  for (const asset of manifest.assets) {
    assetRecord(asset);
    requireThat(
      !seen.has(asset.path),
      `Duplicate manifest asset: ${asset.path}`,
    );
    seen.add(asset.path);
  }
}

export async function inspectLive({
  expectedCurrentSha = "",
  firstProduction = false,
  stage = "production",
  fetcher = fetch,
}) {
  requireThat(
    stage === "preview" || stage === "production",
    "Invalid release stage",
  );
  requireThat(
    !expectedCurrentSha || SHA.test(expectedCurrentSha),
    "Expected current SHA must be a full lowercase commit SHA",
  );
  const infoBytes = await get("release-info.json", fetcher, true);
  const htmlBytes = await get("", fetcher, true);
  if (!infoBytes) {
    requireThat(!expectedCurrentSha, "Expected production baseline is missing");
    const html = htmlBytes?.toString("utf8") || "";
    requireThat(
      !/name=["']release-(?:source|stage)["']/i.test(html),
      "Production metadata is missing but release HTML exists",
    );
    requireThat(
      !htmlBytes || html.includes("data-pages-preview-noindex"),
      "Unknown root HTML is not evidence of a first deployment",
    );
    requireThat(
      stage === "preview" || firstProduction,
      "No baseline is allowed only for an explicitly confirmed first production deployment",
    );
    return {
      schema_version: 1,
      stage,
      source_sha: null,
      html_sha256: htmlBytes ? sha256(htmlBytes) : null,
      info_sha256: null,
      manifest_sha256: null,
    };
  }
  const info = parseJson(infoBytes, "release metadata");
  requireThat(
    info.stage === "production" &&
      info.base_path === BASE_PATH &&
      SHA.test(info.source_sha),
    "Invalid live production metadata",
  );
  requireThat(
    stage !== "preview",
    "Same-site preview is forbidden after production has been deployed",
  );
  requireThat(
    !firstProduction,
    "First production flag conflicts with existing production",
  );
  requireThat(
    expectedCurrentSha === info.source_sha,
    "Current production SHA differs from the approved baseline",
  );
  requireThat(htmlBytes, "Production HTML is missing");
  const html = htmlBytes.toString("utf8");
  requireThat(
    meta(html, "release-source") === info.source_sha &&
      meta(html, "release-stage") === "production",
    "Live HTML/source metadata mismatch",
  );
  requireThat(
    Array.isArray(info.wasm) && info.wasm.length > 0,
    "Missing live WASM manifest",
  );
  const wasmSeen = new Set();
  for (const wasm of info.wasm) {
    requireThat(
      typeof wasm.url === "string" && wasm.url.startsWith(BASE_PATH),
      "Invalid WASM URL",
    );
    const assetPath = safeAssetPath(wasm.url.slice(BASE_PATH.length));
    requireThat(
      assetPath.endsWith(".wasm") && !wasmSeen.has(assetPath),
      "Invalid or duplicate WASM asset",
    );
    assetRecord({
      path: assetPath,
      bytes: wasm.bytes,
      sha256: wasm.sha256,
      source_shas: [info.source_sha],
    });
    wasmSeen.add(assetPath);
  }
  let manifest = null;
  let manifestDigest = null;
  if (info.asset_manifest !== undefined) {
    requireThat(
      info.asset_manifest.url === `${BASE_PATH}asset-retention.json` &&
        DIGEST.test(info.asset_manifest.sha256),
      "Missing or invalid asset manifest hash",
    );
    const bytes = await get("asset-retention.json", fetcher);
    requireThat(
      sha256(bytes) === info.asset_manifest.sha256 &&
        bytes.length === info.asset_manifest.bytes,
      "Published asset manifest hash/length mismatch",
    );
    manifest = parseJson(bytes, "asset manifest");
    checkManifest(manifest, info.source_sha);
    manifestDigest = sha256(bytes);
  }
  return {
    schema_version: 1,
    stage,
    source_sha: info.source_sha,
    html_sha256: sha256(htmlBytes),
    info_sha256: sha256(infoBytes),
    manifest_sha256: manifestDigest,
    html,
    info,
    manifest,
  };
}

export async function verifyCurrent(snapshot, fetcher = fetch) {
  const current = await inspectLive({
    expectedCurrentSha: snapshot.source_sha || "",
    firstProduction: !snapshot.source_sha && snapshot.stage === "production",
    stage: snapshot.stage,
    fetcher,
  });
  for (const key of [
    "source_sha",
    "html_sha256",
    "info_sha256",
    "manifest_sha256",
  ]) {
    requireThat(
      current[key] === snapshot[key],
      `Current production changed since inspection: ${key}`,
    );
  }
}

function mergeRecord(records, incoming) {
  const previous = records.get(incoming.path);
  if (previous) {
    requireThat(
      previous.sha256 === incoming.sha256 && previous.bytes === incoming.bytes,
      `Asset path/hash collision: ${incoming.path}`,
    );
    previous.source_shas = [
      ...new Set([...previous.source_shas, ...incoming.source_shas]),
    ].sort();
  } else
    records.set(incoming.path, {
      ...incoming,
      source_shas: [...incoming.source_shas].sort(),
    });
}

export async function retainAssets({
  candidateDir,
  candidateStaticDir,
  sourceSha,
  baselineDir,
  baselineStaticDir,
  snapshot,
  fetcher = fetch,
}) {
  requireThat(snapshot.stage === "production", "Retention is production-only");
  const candidateAssets = await inventory(
    candidateDir,
    candidateStaticDir,
    sourceSha,
  );
  const records = new Map();
  candidateAssets.forEach((asset) => mergeRecord(records, asset));
  if (snapshot.source_sha) {
    requireThat(
      baselineDir && baselineStaticDir,
      "A rebuilt baseline is required",
    );
    const rebuiltHtml = await readFile(
      path.join(baselineDir, "index.html"),
      "utf8",
    );
    const withoutReleaseMeta = (html) =>
      html.replace(/<meta\s+[^>]*>/gi, (tag) =>
        /\bname=["']release-(?:source|stage)["']/i.test(tag) ? "" : tag,
      );
    requireThat(
      withoutReleaseMeta(snapshot.html) === withoutReleaseMeta(rebuiltHtml),
      "Rebuilt HTML differs from current production; asset closure is unproven",
    );
    const baselineAssets = await inventory(
      baselineDir,
      baselineStaticDir,
      snapshot.source_sha,
    );
    const baselineMap = new Map(
      baselineAssets.map((asset) => [asset.path, asset]),
    );
    const baselineWasm = baselineAssets.filter((asset) =>
      asset.path.endsWith(".wasm"),
    );
    requireThat(
      baselineWasm.length === snapshot.info.wasm.length,
      "Rebuilt/live WASM set mismatch",
    );
    for (const wasm of snapshot.info.wasm) {
      const asset = baselineMap.get(wasm.url.slice(BASE_PATH.length));
      requireThat(
        asset && asset.sha256 === wasm.sha256 && asset.bytes === wasm.bytes,
        "Rebuilt/live WASM hash mismatch",
      );
    }
    const previousAssets = snapshot.manifest?.assets || baselineAssets;
    if (snapshot.manifest) {
      const published = new Map(
        previousAssets.map((asset) => [asset.path, asset]),
      );
      for (const asset of baselineAssets) {
        const previous = published.get(asset.path);
        requireThat(
          previous &&
            previous.sha256 === asset.sha256 &&
            previous.bytes === asset.bytes,
          `Rebuilt asset absent or changed in published manifest: ${asset.path}`,
        );
      }
    }
    // Validate every retained asset, not just the HTML's direct imports. This also
    // carries the prior manifest forward without dropping older release hashes.
    for (const asset of previousAssets) {
      assetRecord(asset);
      mergeRecord(records, asset);
      const bytes = await get(asset.path, fetcher);
      requireThat(
        bytes.length === asset.bytes && sha256(bytes) === asset.sha256,
        `Live asset hash/length mismatch: ${asset.path}`,
      );
      const target = path.join(candidateDir, asset.path);
      try {
        const stat = await lstat(target);
        requireThat(
          stat.isFile() && !stat.isSymbolicLink(),
          `Unsafe candidate asset: ${asset.path}`,
        );
        requireThat(
          sha256(await readFile(target)) === asset.sha256,
          `Asset path/hash collision: ${asset.path}`,
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: "wx" });
      }
    }
  } else requireThat(!baselineDir, "Unexpected baseline for first production");
  const manifest = {
    schema_version: 1,
    source_sha: sourceSha,
    base_path: BASE_PATH,
    previous_source_sha: snapshot.source_sha,
    assets: [...records.values()].sort((a, b) =>
      a.path.localeCompare(b.path, "en"),
    ),
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(candidateDir, "asset-retention.json"),
    manifestBytes,
  );
  const infoPath = path.join(candidateDir, "release-info.json");
  const info = parseJson(
    await readFile(infoPath),
    "candidate release metadata",
  );
  requireThat(
    info.source_sha === sourceSha &&
      info.stage === "production" &&
      info.base_path === BASE_PATH,
    "Candidate release metadata mismatch",
  );
  info.asset_manifest = {
    url: `${BASE_PATH}asset-retention.json`,
    bytes: manifestBytes.length,
    sha256: sha256(manifestBytes),
  };
  await writeFile(infoPath, `${JSON.stringify(info, null, 2)}\n`);
  await verifyCurrent(snapshot, fetcher);
  return manifest;
}

async function main() {
  const [command, stateFile] = process.argv.slice(2);
  requireThat(
    stateFile,
    "Usage: pages-assets.mjs inspect|retain|verify <snapshot.json>",
  );
  if (command === "inspect") {
    const snapshot = await inspectLive({
      expectedCurrentSha: process.env.EXPECTED_CURRENT_SHA || "",
      firstProduction: process.env.FIRST_PRODUCTION === "true",
      stage: process.env.RELEASE_STAGE,
    });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (process.env.GITHUB_OUTPUT)
      await writeFile(
        process.env.GITHUB_OUTPUT,
        `baseline_sha=${snapshot.source_sha || ""}\n`,
        { flag: "a" },
      );
  } else if (command === "hosted") {
    const snapshot = await inspectLive({
      expectedCurrentSha: process.env.EXPECTED_CURRENT_SHA,
      fetcher: fetch,
    });
    requireThat(
      snapshot.manifest,
      "The deployed production manifest is missing",
    );
    for (const asset of snapshot.manifest.assets) {
      const bytes = await get(asset.path, fetch);
      requireThat(
        bytes.length === asset.bytes && sha256(bytes) === asset.sha256,
        `Hosted asset hash/length mismatch: ${asset.path}`,
      );
    }
    await verifyCurrent(snapshot);
    await writeFile(
      stateFile,
      `${JSON.stringify({ source_sha: snapshot.source_sha, asset_manifest_sha256: snapshot.manifest_sha256, verified_assets: snapshot.manifest.assets }, null, 2)}\n`,
    );
  } else {
    const snapshot = parseJson(await readFile(stateFile), "snapshot");
    if (command === "verify") await verifyCurrent(snapshot);
    else if (command === "retain")
      await retainAssets({
        candidateDir: path.resolve("public"),
        candidateStaticDir: path.resolve("assets"),
        sourceSha: process.env.SOURCE_SHA,
        baselineDir: process.env.BASELINE_DIR
          ? path.join(process.env.BASELINE_DIR, "public")
          : undefined,
        baselineStaticDir: process.env.BASELINE_DIR
          ? path.join(process.env.BASELINE_DIR, "assets")
          : undefined,
        snapshot,
      });
    else throw new Error(`Unknown command: ${command}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
