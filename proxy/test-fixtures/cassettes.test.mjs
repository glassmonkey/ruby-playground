import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cassetteDirectory = new URL("./cassettes/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("./cassettes/manifest.json", import.meta.url), "utf8"),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("each recorded GET resolves to a fixed RubyGems URL and verified replay body", async () => {
  for (const [request, response] of Object.entries(manifest.responses)) {
    assert.match(request, /^GET \/(?:info|gems)\//);
    assert.equal(response.url, `${manifest.source}${request.slice(4)}`);
    assert.equal(new URL(response.url).origin, manifest.source);
    assert.ok(response.headers["content-type"]);
    for (const [name, value] of Object.entries(response.headers)) {
      assert.ok(manifest.capture.headers.captured.includes(name));
      assert.equal(value, value.trim());
      assert.ok(!manifest.capture.headers.excluded.includes(name));
    }
    const body = await readFile(new URL(response.body.file, cassetteDirectory));
    assert.equal(body.byteLength, response.body.bytes);
    assert.equal(sha256(body), response.body.sha256);
  }
});

test("recorded gem archives retain the declared MIT license texts and dependency", async () => {
  for (const pack of Object.values(manifest.packages)) {
    const license = await readFile(
      new URL(pack.licenseFile, cassetteDirectory),
    );
    assert.equal(pack.license, "MIT");
    assert.equal(sha256(license), pack.licenseFileSha256);
  }
  assert.deepEqual(manifest.packages["pastel 0.8.0"].runtimeDependencies, [
    "tty-color ~> 0.5",
  ]);
});

test("the missing gem cassette keeps status 403 and redacts only volatile XML IDs", async () => {
  const response = manifest.responses["GET /gems/rainbow-0.0.1.gem"];
  const body = await readFile(new URL(response.body.file, cassetteDirectory));
  const text = body.toString("utf8");
  assert.equal(response.status, 403);
  assert.ok(Number.isSafeInteger(response.body.rawBytes));
  assert.ok(response.body.rawBytes >= body.byteLength);
  assert.match(response.body.rawSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(response.body.rawSha256, response.body.sha256);
  assert.match(text, /<RequestId>fixture-request-id<\/RequestId>/);
  assert.match(text, /<HostId>fixture-host-id<\/HostId>/);
  assert.deepEqual(response.body.normalizations, [
    "XML RequestId value replaced with fixture-request-id",
    "XML HostId value replaced with fixture-host-id",
  ]);
});
