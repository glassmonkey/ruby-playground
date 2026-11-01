// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import proxy from "./index";

const env = {
  ALLOWED_ORIGINS: "https://ruby-play.dev, http://127.0.0.1:18888",
};

function stubUpstream(status = 200) {
  const upstream = vi.fn<typeof fetch>(
    async () =>
      new Response("payload", {
        status,
        headers: { "Content-Type": "application/octet-stream" },
      }),
  );
  vi.stubGlobal("fetch", upstream);
  return upstream;
}

async function call(path: string, init: RequestInit = {}) {
  const response = await proxy.fetch(
    new Request(`https://gems.ruby-play.dev${path}`, init),
    env,
  );
  return {
    status: response.status,
    allowOrigin: response.headers.get("Access-Control-Allow-Origin"),
    cacheControl: response.headers.get("Cache-Control"),
    body: await response.text(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gem proxy", () => {
  it.each([
    ["/gems/faker-3.8.0.gem", "public, max-age=31536000, immutable"],
    ["/info/faker", "public, max-age=300"],
  ])(
    "proxies %s with CORS for an allowed origin",
    async (path, cacheControl) => {
      // Arrange
      const upstream = stubUpstream();
      // Act
      const got = await call(path, {
        headers: { Origin: "https://ruby-play.dev" },
      });
      // Assert
      expect({ got, upstream: upstream.mock.calls[0]?.[0] }).toEqual({
        got: {
          status: 200,
          allowOrigin: "https://ruby-play.dev",
          cacheControl,
          body: "payload",
        },
        upstream: `https://rubygems.org${path}`,
      });
    },
  );

  it("proxies without CORS for an origin outside the list", async () => {
    stubUpstream();
    expect(
      (
        await call("/info/faker", {
          headers: { Origin: "https://example.com" },
        })
      ).allowOrigin,
    ).toBeNull();
  });

  it("passes a rubygems.org 404 through with CORS and no caching", async () => {
    stubUpstream(404);
    expect(
      await call("/gems/nope-1.0.0.gem", {
        headers: { Origin: "http://127.0.0.1:18888" },
      }),
    ).toEqual({
      status: 404,
      allowOrigin: "http://127.0.0.1:18888",
      cacheControl: "no-store",
      body: "payload",
    });
  });

  it.each([500, 503])(
    "passes an upstream %i through with CORS and no caching",
    async (status) => {
      // Arrange
      stubUpstream(status);
      // Act
      const got = await call("/info/faker", {
        headers: { Origin: "https://ruby-play.dev" },
      });
      // Assert
      expect(got).toEqual({
        status,
        allowOrigin: "https://ruby-play.dev",
        cacheControl: "no-store",
        body: "payload",
      });
    },
  );

  it("returns an uncached 500 with CORS when upstream fetch rejects", async () => {
    // Arrange
    const upstream = vi.fn<typeof fetch>(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", upstream);
    // Act
    const got = await call("/info/faker", {
      headers: { Origin: "https://ruby-play.dev" },
    });
    // Assert
    expect({ got, upstreamCalls: upstream.mock.calls.length }).toEqual({
      got: {
        status: 500,
        allowOrigin: "https://ruby-play.dev",
        cacheControl: "no-store",
        body: "Internal Server Error",
      },
      upstreamCalls: 1,
    });
  });

  it.each([
    ["/api/v1/gems/faker.json", "GET", 404],
    ["/gems/faker-3.8.0.gem/extra", "GET", 404],
    ["/gems/faker", "GET", 404],
    ["/info/a%2Fb", "GET", 404],
    ["/info/-rainbow", "GET", 404],
    ["/info/123", "GET", 404],
    ["/gems/.rainbow-3.1.1.gem", "GET", 404],
    ["/info/faker?x=1", "GET", 404],
    ["/", "GET", 404],
    ["/info/faker", "POST", 405],
  ])(
    "refuses %s over %s without contacting rubygems.org",
    async (path, method, status) => {
      const upstream = stubUpstream();
      const got = await call(path, { method });
      expect({
        status: got.status,
        upstreamCalls: upstream.mock.calls.length,
      }).toEqual({
        status,
        upstreamCalls: 0,
      });
    },
  );

  it("proxies a gem name with uppercase letters, which RubyGems allows", async () => {
    const upstream = stubUpstream();
    await call("/info/RedCloth");
    expect(upstream.mock.calls[0]?.[0]).toBe(
      "https://rubygems.org/info/RedCloth",
    );
  });

  it("answers a preflight for an allowed origin", async () => {
    stubUpstream();
    expect(
      await call("/info/faker", {
        method: "OPTIONS",
        headers: { Origin: "https://ruby-play.dev" },
      }),
    ).toMatchObject({ status: 204, allowOrigin: "https://ruby-play.dev" });
  });
});
