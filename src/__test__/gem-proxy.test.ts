import { describe, expect, it, vi } from "vitest";
import { createGemProxy, requireGemResponse } from "../gem-proxy";

describe("createGemProxy", () => {
  it.each([
    { name: "RedCloth", file: "RedCloth-4.3.2.gem" },
    { name: "rack-test", file: "rack-test-2.2.0.gem" },
  ])("uses typed proxy paths for $name", async ({ name, file }) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    const sut = createGemProxy("https://gems.example.test", fetcher);

    const gotUrl = sut.gemUrl(file);
    const gotInfo = await sut.fetchInfo(name);
    const gotGem = await sut.fetchGem(file);

    expect(gotUrl.toString()).toBe(`https://gems.example.test/gems/${file}`);
    expect(gotInfo.status).toBe(200);
    expect(gotGem.status).toBe(200);
    expect(fetcher.mock.calls.map(([request]) => request.toString())).toEqual([
      `https://gems.example.test/info/${name}`,
      `https://gems.example.test/gems/${file}`,
    ]);
  });

  it.each(["_hidden", "-hidden", ".hidden", "123", "has space"])(
    "rejects invalid gem name %s before making a request",
    async (name) => {
      const fetcher = vi.fn<typeof fetch>();
      const sut = createGemProxy("https://gems.example.test", fetcher);

      await expect(sut.fetchInfo(name)).rejects.toThrow("Invalid gem name");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    "../rack-1.0.gem",
    "_rack-1.0.gem",
    "-rack-1.0.gem",
    ".rack-1.0.gem",
    "rack-1.0",
  ])("rejects invalid gem file %s before making a request", async (file) => {
    const fetcher = vi.fn<typeof fetch>();
    const sut = createGemProxy("https://gems.example.test", fetcher);

    expect(() => sut.gemUrl(file)).toThrow("Invalid gem file name");
    await expect(sut.fetchGem(file)).rejects.toThrow("Invalid gem file name");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("requireGemResponse", () => {
  it.each([403, 404])(
    "reports upstream not found for HTTP %i",
    async (status) => {
      const sut = requireGemResponse(
        Promise.resolve(new Response(null, { status })),
        "/gems/missing-1.0.gem",
        "missing on rubygems.org",
        "proxy unavailable",
      );

      await expect(sut).rejects.toThrow("missing on rubygems.org");
    },
  );

  it("preserves the network failure as cause and gives connection guidance", async () => {
    const cause = new TypeError("Failed to fetch");
    const sut = requireGemResponse(
      Promise.reject(cause),
      "/info/rack",
      "rack missing",
      "Start npm run proxy:dev",
    );

    await expect(sut).rejects.toMatchObject({
      message: "Start npm run proxy:dev",
      cause,
    });
  });

  it("keeps HTTP errors distinct from connection failures", async () => {
    const sut = requireGemResponse(
      Promise.resolve(new Response(null, { status: 503 })),
      "/info/rack",
      "rack missing",
      "proxy unavailable",
    );

    await expect(sut).rejects.toThrow("Gem download failed: /info/rack (503).");
  });

  it("returns a successful response with its status and bytes intact", async () => {
    const response = new Response("gem bytes", { status: 206 });
    const sut = requireGemResponse(
      Promise.resolve(response),
      "/gems/rack-1.0.gem",
      "rack missing",
      "proxy unavailable",
    );

    const got = await sut;

    expect({
      sameResponse: got === response,
      status: got.status,
      body: await got.text(),
    }).toEqual({
      sameResponse: true,
      status: 206,
      body: "gem bytes",
    });
  });
});
