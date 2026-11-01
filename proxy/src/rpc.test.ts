// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hc } from "hono/client";
import type { AppType } from "./index";

describe("gem proxy RPC contract", () => {
  it("builds the proxied URLs from the route types", () => {
    // Arrange
    const client = hc<AppType>("https://gems.ruby-play.dev");
    // Act
    const urls = [
      client.info[":name"].$url({ param: { name: "rainbow" } }).href,
      client.gems[":file"].$url({ param: { file: "rainbow-3.1.1.gem" } }).href,
    ];
    // Assert
    expect(urls).toEqual([
      "https://gems.ruby-play.dev/info/rainbow",
      "https://gems.ruby-play.dev/gems/rainbow-3.1.1.gem",
    ]);
  });

  it("rejects a wrong parameter at type-check time", () => {
    const client = hc<AppType>("https://gems.ruby-play.dev");
    // @ts-expect-error the route parameter is `name`, not `gem`.
    const url = client.info[":name"].$url({ param: { gem: "rainbow" } });
    expect(url).toBeInstanceOf(URL);
  });

  it("uses the same hono version in the proxy and the app", () => {
    // The app's RPC client and the Worker must agree on the route types.
    const version = (path: string) =>
      JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"))
        .dependencies.hono;
    expect(version("../package.json")).toBe(version("../../package.json"));
  });
});
