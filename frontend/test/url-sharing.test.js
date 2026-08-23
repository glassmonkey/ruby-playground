import { describe, expect, it } from "vitest";
import { decodeSharedCode, urlSearchWithCode } from "../src/url-sharing.js";

describe("urlSearchWithCode", () => {
  it("encodes the code into a c param when there's no existing query", () => {
    const sut = urlSearchWithCode;

    const got = sut("", "puts 1");

    expect(got).toMatch(/^\?c=/);
  });

  it("preserves other existing query params while still encoding c correctly", () => {
    const sut = urlSearchWithCode;
    const code = "puts 1";

    const got = sut("?foo=bar", code);

    const params = new URLSearchParams(got);
    expect(params.get("foo")).toBe("bar");
    expect(decodeSharedCode(got)).toBe(code);
  });
});

describe("decodeSharedCode", () => {
  it("decodes a c param produced by urlSearchWithCode", () => {
    const sut = decodeSharedCode;
    const encoded = urlSearchWithCode("", "puts 1");

    const got = sut(encoded);

    expect(got).toBe("puts 1");
  });

  it("returns null when there is no c param", () => {
    const sut = decodeSharedCode;

    const got = sut("");

    expect(got).toBeNull();
  });

  it("returns null for a c param that isn't valid lz-string data", () => {
    const sut = decodeSharedCode;

    const got = sut("?c=not-a-valid-lzstring-payload");

    expect(got).toBeNull();
  });
});

describe("urlSearchWithCode + decodeSharedCode round trip", () => {
  it.each([
    ["single line", "puts 1"],
    ["multi-line with special chars", "puts 'hi'\n# comment: 日本語 & <script>"],
    ["code containing an ampersand and equals sign", "a = 1 && b = 2"],
  ])("recovers the original code for: %s", (_label, code) => {
    const sut = decodeSharedCode;
    const encoded = urlSearchWithCode("", code);

    const got = sut(encoded);

    expect(got).toBe(code);
  });
});
