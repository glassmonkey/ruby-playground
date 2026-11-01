import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

// Recorded RubyGems responses replay through the local Wrangler Worker by
// default. GEM_PROXY_URL opts into a separately selected external target.
const allowedOrigin = process.env.GEM_PROXY_ORIGIN ?? "http://127.0.0.1:18888";
const GEM = "rainbow";
const VERSION = "3.1.1";

test("serves the compact index with CORS for the allowed origin", async ({
  request,
}) => {
  // Act
  const response = await request.get(`/info/${GEM}`, {
    headers: { Origin: allowedOrigin },
  });
  // Assert
  expect({
    status: response.status(),
    allowOrigin: response.headers()["access-control-allow-origin"],
    cacheControl: response.headers()["cache-control"],
    listsVersion: (await response.text()).includes(`\n${VERSION} `),
  }).toEqual({
    status: 200,
    allowOrigin: allowedOrigin,
    cacheControl: "public, max-age=300",
    listsVersion: true,
  });
});

test("serves the .gem whose SHA-256 matches the compact index", async ({
  request,
}) => {
  // Arrange
  const index = await (await request.get(`/info/${GEM}`)).text();
  const published = new RegExp(
    `^${VERSION} .*checksum:([0-9a-f]{64})`,
    "m",
  ).exec(index)?.[1];
  // Act
  const response = await request.get(`/gems/${GEM}-${VERSION}.gem`, {
    headers: { Origin: allowedOrigin },
  });
  // Assert
  expect({
    status: response.status(),
    allowOrigin: response.headers()["access-control-allow-origin"],
    cacheControl: response.headers()["cache-control"],
    sha256: createHash("sha256")
      .update(await response.body())
      .digest("hex"),
  }).toEqual({
    status: 200,
    allowOrigin: allowedOrigin,
    cacheControl: "public, max-age=31536000, immutable",
    sha256: published,
  });
});

test("replays the real pastel dependency index and both gem archives", async ({
  request,
}) => {
  const pastelInfo = await request.get("/info/pastel");
  const pastelIndex = await pastelInfo.text();
  const ttyColorInfo = await request.get("/info/tty-color");
  const ttyColorIndex = await ttyColorInfo.text();
  const pastelGem = await request.get("/gems/pastel-0.8.0.gem");
  const ttyColorGem = await request.get("/gems/tty-color-0.6.0.gem");
  const got = {
    pastel: {
      infoStatus: pastelInfo.status(),
      dependencyRow: /^0\.8\.0 .*$/m.exec(pastelIndex)?.[0],
      gemStatus: pastelGem.status(),
      gemSha256: createHash("sha256")
        .update(await pastelGem.body())
        .digest("hex"),
    },
    ttyColor: {
      infoStatus: ttyColorInfo.status(),
      versionRow: /^0\.6\.0 .*$/m.exec(ttyColorIndex)?.[0],
      gemStatus: ttyColorGem.status(),
      gemSha256: createHash("sha256")
        .update(await ttyColorGem.body())
        .digest("hex"),
    },
  };

  expect(got).toEqual({
    pastel: {
      infoStatus: 200,
      dependencyRow:
        "0.8.0 tty-color:~> 0.5|checksum:481da9fb7d2f6e6b1a08faf11fa10363172dc40fd47848f096ae21209f805a75,ruby:>= 2.0.0,created_at:2020-07-04T14:13:49Z",
      gemStatus: 200,
      gemSha256:
        "481da9fb7d2f6e6b1a08faf11fa10363172dc40fd47848f096ae21209f805a75",
    },
    ttyColor: {
      infoStatus: 200,
      versionRow:
        "0.6.0 |checksum:6f9c37ca3a4e2367fb2e6d09722762647d6f455c111f05b59f35730eeb24332a,ruby:>= 2.0.0,created_at:2020-11-07T17:34:44Z",
      gemStatus: 200,
      gemSha256:
        "6f9c37ca3a4e2367fb2e6d09722762647d6f455c111f05b59f35730eeb24332a",
    },
  });
});

test("leaves CORS off for an origin outside the list", async ({ request }) => {
  const response = await request.get(`/info/${GEM}`, {
    headers: { Origin: "https://example.com" },
  });
  expect({
    status: response.status(),
    allowOrigin: response.headers()["access-control-allow-origin"],
  }).toEqual({ status: 200, allowOrigin: undefined });
});

test("passes a missing .gem through as an uncached failure", async ({
  request,
}) => {
  // rubygems.org answers a missing .gem with 403 from its storage.
  const response = await request.get(`/gems/${GEM}-0.0.1.gem`, {
    headers: { Origin: allowedOrigin },
  });
  expect({
    status: response.status(),
    ok: response.ok(),
    allowOrigin: response.headers()["access-control-allow-origin"],
    cacheControl: response.headers()["cache-control"],
  }).toEqual({
    status: 403,
    ok: false,
    allowOrigin: allowedOrigin,
    cacheControl: "no-store",
  });
});

for (const [method, path, status] of [
  ["GET", `/api/v1/gems/${GEM}.json`, 404],
  ["GET", `/info/${GEM}?x=1`, 404],
  ["POST", `/info/${GEM}`, 405],
  ["OPTIONS", `/info/${GEM}`, 204],
] as const) {
  test(`answers ${method} ${path} with ${status}`, async ({ request }) => {
    const response = await request.fetch(path, {
      method,
      headers: { Origin: allowedOrigin },
    });
    expect(response.status()).toBe(status);
  });
}
