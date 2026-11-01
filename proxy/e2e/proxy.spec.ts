import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

// Real requests through the proxy to rubygems.org. A small, long-published gem
// keeps the downloads light and the expected bytes stable.
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
    ok: response.ok(),
    allowOrigin: response.headers()["access-control-allow-origin"],
    cacheControl: response.headers()["cache-control"],
  }).toEqual({
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
