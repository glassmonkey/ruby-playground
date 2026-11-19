import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestInfo } from "@playwright/test";

type SourceProvenance = {
  actualGitHead: string;
  testSourceSha256: string;
  observerFile: string;
  observerSourceSha256: string;
  provenanceSourceSha256: string;
  assets: Record<string, { path: string; sha256: string }>;
};

const sourceSnapshots = new WeakMap<object, SourceProvenance>();
const assetHashesByRoot = new Map<
  string,
  Promise<Record<string, { path: string; sha256: string }>>
>();

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function getAssetHashes(root: string) {
  let cached = assetHashesByRoot.get(root);
  if (!cached) {
    const paths = {
      analysisServerSource: join(root, "src/lsp/analysis_server.rb"),
      analysisServerAsset: join(root, "assets/lsp/analysis_server.rb"),
      manifest: join(root, "public/lsp/manifest.json"),
      compressedWasm: join(root, "public/lsp/typeprof-analysis.wasm.gz"),
    };
    cached = Promise.all(
      Object.values(paths).map((path) => readFile(path)),
    ).then(
      (bytes) =>
        Object.fromEntries(
          Object.entries(paths).map(([name, path], index) => [
            name,
            { path, sha256: sha256(bytes[index]) },
          ]),
        ) as Record<string, { path: string; sha256: string }>,
    );
    assetHashesByRoot.set(root, cached);
  }
  return cached;
}

export async function captureE2eSourceProvenance(testInfo: TestInfo) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: testInfo.config.rootDir,
    encoding: "utf8",
  }).trim();
  const actualGitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const observerUrl = new URL("./completion-lsp-observer.ts", import.meta.url);
  const [testSource, observerSource, provenanceSource, assets] =
    await Promise.all([
      readFile(testInfo.file),
      readFile(observerUrl),
      readFile(fileURLToPath(import.meta.url)),
      getAssetHashes(root),
    ]);
  return {
    actualGitHead,
    testSourceSha256: sha256(testSource),
    observerFile: fileURLToPath(observerUrl),
    observerSourceSha256: sha256(observerSource),
    provenanceSourceSha256: sha256(provenanceSource),
    assets,
  };
}

test.beforeEach(async ({ browserName }, testInfo) => {
  void browserName;
  sourceSnapshots.set(testInfo, await captureE2eSourceProvenance(testInfo));
});

test.afterEach(async ({ browserName }, testInfo) => {
  void browserName;
  const snapshot = sourceSnapshots.get(testInfo);
  if (!snapshot)
    throw new Error("E2E source provenance was not captured before test");
  const record = {
    sourceCapturedBeforeTest: true,
    actualGitHead: snapshot.actualGitHead,
    requestedUiHead: process.env.COMPLETION_UI_HEAD ?? null,
    runtimeCommit: process.env.COMPLETION_RUNTIME_COMMIT ?? null,
    testFile: testInfo.file,
    testSourceSha256: snapshot.testSourceSha256,
    observerFile: snapshot.observerFile,
    observerSourceSha256: snapshot.observerSourceSha256,
    provenanceSourceSha256: snapshot.provenanceSourceSha256,
    assets: snapshot.assets,
    project: testInfo.project.name,
    title: testInfo.title,
    status: testInfo.status,
    expectedStatus: testInfo.expectedStatus,
  };
  const serialized = JSON.stringify(record, null, 2);
  await mkdir(testInfo.outputPath(), { recursive: true });
  await writeFile(
    testInfo.outputPath("e2e-source-provenance.json"),
    serialized,
    "utf8",
  );
  await testInfo.attach("e2e-source-provenance.json", {
    body: serialized,
    contentType: "application/json",
  });
});
