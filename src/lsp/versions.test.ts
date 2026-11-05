import { describe, expect, it } from "vitest";
import { isLspRubyVersion } from "./versions";

describe("isLspRubyVersion", () => {
  it.each([
    ["3.3", true],
    ["4.0", true],
    ["3.2", false],
    ["3.4", false],
    ["4.1", false],
  ] as const)("returns %s => %s", (version, supported) => {
    expect(isLspRubyVersion(version)).toBe(supported);
  });
});
