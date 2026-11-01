import { describe, expect, it } from "vitest";
import { compressToEncodedURIComponent } from "lz-string";
import {
  buildShareUrl,
  MAX_COMPRESSED_LENGTH,
  MAX_SHARE_URL_BYTES,
  MAX_SOURCE_LENGTH,
  parseShareUrl,
} from "../share";

const base = "https://ruby.example/playground?theme=dark#editor";
const fallback = 'puts "Fallback"';
const encodedUrl = (code: string) =>
  `https://ruby.example/?c=${encodeURIComponent(compressToEncodedURIComponent(code))}`;

// Generated during development with lz-string 1.5.0 from "x".repeat(1_000_000).
// Keep compression out of this 5-second parser regression; the compressed URL still expands past
// the same 50,000-character limit.
const highExpansionPayload = [
  "https://ruby.example/?c=B418ZXTt-DFOS1b0c17Pd-wYUcSaWeRZVdTbXfQ408y62%2Bx519z73-wMFDhI0WPETJU6TN",
  "lz5CxUuUrVa9Rs1btO3Xv0HDR4ydNnzFy1es3bd%2Bw8dPnL12-cfPX7z99--AYFBwSGhYeERkVHRMbFx8QmJSckpqWnpGZl",
  "Z2Tm5efkFhUXFJaVl5RWVVdU1tXX1DY1NzS2tbe0dnV3dPb19-QODQ8Mjo2PjE5NT0zOzc-MLi0vLK6tr6xubW9s7u3v7B4d",
  "HxyenZ%2BcXl1fXN7d39w%2BPT88vr2-vH59f3z%2B-f-8AwFA4Eg0Fg8EQyFQ6Ew2Fw%2BEIxFI5Eo1Fo9EYzFY7E43F4-E",
  "EwlE4kk0lk8kUylU6k02l0%2BkMxlM5ks1ls9kczlc7k83l8-kCwVC4Ui0Vi8USyVS6Uy2Vy%2BUKxVK5Uq1Vq9UazVa7U63",
  "V6-UGw1G40m01m80Wy1W602212%2B0Ox1O50u11u90ez1e70%2B31%2B-0BwNB4Mh0Nh8MRyNR6Mx2Nx%2BMJxNJ5Mp1Np9M",
  "ZzNZ7M53N5-MFwtF4sl0tl8sVytV6s12t1%2BsNxtN5st1tt9sdztd7s93t9-sDwdD4cj0dj8cTydT6cz2dz%2BcLxdL5cr1",
  "dr9cbzdb7c73d7-cHw9H48n09n88Xy9X683293%2B8Px9P58v19v98fz9f78-39--8AYBQHASBoFgeBEGQVB0EwbBcHwQhiF",
  "IchKGoWh6EYZhWHYThuF4fhBGEURxEkaRZHkRRlFUdRNG0XR9EMYxTHMSxrFsexHGcVx3E8bxfH8QJglCcJImiWJ4kSZJUnS",
  "TJslyfJCmKUpykqapanqRpmladpOm6Xp%2BkGYZRnGSZplmeZFmWVZ1k2bZdn2Q5jlOc5LmuW57keZ5XneT5vl%2Bf5AWBUF",
  "wUhaFYXhRFkVRdFMWxXF8UJYlSXJSlqVpelGWZVl2U5bleX5QVhVFcVJWlWV5UVZVVXVTVtV1fVDWNU1zUta1bXtR1nVdd1P",
  "W9X1-UDYNQ3DSNo1jeNE2TVN00zbNc3zQti1LctK2rWt60bZtW3bTtu17ftB2HUdx0nadZ3nRdl1XddN23Xd90PY9T3PS9r1",
  "ve9H2fV930-b9f3-QDgNA8DIOg2D4MQ5DUPQzDsNw-DCOI0jyMo6jaPoxjmNY9jOO43j%2BME4TRPEyTpNk%2BTFOU1T1M07",
  "TdP0wzjNM8zLOs2z7Mc5zXPczzvN8-zAuC0Lwsi6LYvixLktS9LMuy3L8sK4rSvKyrqtq%2BrGua1r2s67rev6wbhtG8bJum",
  "2b5sW5bVvWzbtt2-bDuO07zsu67bvux7nte97Pu%2B37-sB4HQfByHodh%2BHEeR1H0cx7HcfxwnidJ8nKep2n6cZ5nWfZzn",
  "ud5-nBeF0Xxcl6XZflxXldV9XNe13X9cN43TfNy3rdt%2B3Hed133c973ff9wPg9D8PI%2Bj2P48T5PU-TzPs9z-PC%2BL0v",
  "y8r6va-rxvm9b9vO%2B73v%2B8H4fR-Hyfp9n%2BfF%2BX1f1837fd-3w-j9P8-L%2Bv2-78f5-X-fz-v9---ADAFAOASA0B",
  "YDwEQMgVA6BMDYFwPgQgxBSDkEoNQWg9BGDMFYOwTg3BeD8EEMIUQ4hJDSFkPIRQyhVDqE0NoXQ%2BhDDGFMOYSw1hbD2EcM",
  "4Vw7hPDeF8P4QIwRQjhEiNEWI8REjJFSOkTI2Rcj5EKMUUo5RKjVFqPURozRWjtE6N0Xo-RBjDFGOMSY0xZjzEWMsVY6xNjb",
  "F2PsQ4xxTjnEuNcW49xHjPFeO8T43xfj-EBMCUE4JITQlhPCREyJUTokxNiXE%2BJCTElJOSSk1JaT0kZMyVk7JOTcl5PyQU",
  "wpRTiklNKWU8pFTKlVOqTU2pdT6kNMaU05pLTWltPaR0zpXTuk9N6X0-pAzBlDOGSM0ZYzxkTMmVM6ZMzZlzPmQsxZSzlkrN",
  "WWs9ZGzNlbO2Ts3Zez9kHMOUc45JzTlnPORcy5Vzrk3NuXc%2B5DzHlPOeS815bz3kfM%2BV875Pzfl-P%2BQCwFQLgUgtBW",
  "C8FELIVQuhTC2FcL4UIsRUi5FKLUVovRRizFWLsU4txXi-FBLCVEuJSS0lZLyUUspVS6lNLaV0vpQyxlTLmUstZWy9lHLOVc",
  "u5Ty3lfL%2BUCsFUK4VIrRVivFRKyVUrpUytlXK%2BVCrFVKuVSq1Var1Uas1Vq7VOrdV6v1Qaw1RrjUmtNWa81FrLVWutTa",
  "21dr7UOsdU651LrXVuvdR6z1XrvU%2Bt9X6-1AbA1BuDSG0NYbw3PyAA",
].join("");

describe("shared playground URLs", () => {
  it.each([
    "",
    'puts "Hello"\n',
    'puts "こんにちは 🌸"\n',
    "\u0000\ud800\uffff",
  ])("round trips source %j", (code) => {
    const url = buildShareUrl(base, { code, version: "4.0" });
    expect(parseShareUrl(url, fallback)).toEqual({
      code,
      version: "4.0",
      gemfile: "",
    });
    expect(new URL(url).searchParams.get("theme")).toBe("dark");
    expect(new URL(url).hash).toBe("#editor");
  });

  it("round trips the Gemfile and drops the parameter when it is empty", () => {
    // Arrange
    const gemfile = 'gem "faker", "3.8.0"\n';
    // Act
    const withGems = buildShareUrl(base, { code: "puts 1", gemfile });
    const withoutGems = buildShareUrl(withGems, {
      code: "puts 1",
      gemfile: "",
    });
    // Assert
    expect({
      parsed: parseShareUrl(withGems, fallback),
      cleared: new URL(withoutGems).searchParams.has("g"),
    }).toEqual({
      parsed: { code: "puts 1", version: "4.0", gemfile },
      cleared: false,
    });
  });

  it("round trips the Gemfile.lock only while a Gemfile is present", () => {
    // Arrange
    const gemfile = 'gem "faker"\n';
    const lock = [
      { name: "faker", version: "3.8.0", source: "rubygems" as const },
      { name: "json", version: "2.18.0", source: "builtin" as const },
    ];
    // Act
    const locked = buildShareUrl(base, { code: "puts 1", gemfile, lock });
    const withoutGemfile = buildShareUrl(base, { code: "puts 1", lock });
    // Assert
    expect({
      parsed: parseShareUrl(locked, fallback),
      dropped: new URL(withoutGemfile).searchParams.has("l"),
    }).toEqual({
      parsed: { code: "puts 1", version: "4.0", gemfile, lock },
      dropped: false,
    });
  });

  it("keeps the Gemfile but drops a malformed Gemfile.lock with a warning", () => {
    // Arrange
    const url = new URL(
      buildShareUrl(base, { code: "puts 1", gemfile: 'gem "faker"' }),
    );
    url.searchParams.set("l", compressToEncodedURIComponent("faker ../../etc"));
    // Act
    const parsed = parseShareUrl(url, fallback);
    // Assert
    expect(parsed).toEqual({
      code: "puts 1",
      version: "4.0",
      gemfile: 'gem "faker"',
      warning: "Shared gem versions are invalid. Gems will be resolved again.",
    });
  });

  it.each(["html", "console"])(
    "accepts old f=%s links without losing source",
    (format) => {
      // Arrange
      const url = `${encodedUrl('puts "legacy"')}&v=3.4&f=${format}`;
      // Act
      const got = parseShareUrl(url, fallback);
      // Assert
      expect(got).toEqual({
        code: 'puts "legacy"',
        version: "3.4",
        gemfile: "",
      });
    },
  );

  it("reads lz-string URI payloads produced independently", () => {
    const code = 'puts "Ruby"\n'.repeat(400);
    expect(parseShareUrl(encodedUrl(code), fallback).code).toBe(code);
  });

  it("accepts the exact source length boundary", () => {
    const code = "あ".repeat(MAX_SOURCE_LENGTH);
    expect(parseShareUrl(buildShareUrl(base, { code }), fallback).code).toBe(
      code,
    );
  });

  it("uses fallback without warnings when no sharing parameters exist", () => {
    expect(parseShareUrl(base, fallback)).toEqual({
      code: fallback,
      version: "4.0",
      gemfile: "",
    });
  });

  it("normalizes unsupported version without losing valid code", () => {
    const parsed = parseShareUrl(
      `${encodedUrl("puts 42")}&v=9.9&f=javascript`,
      fallback,
    );
    expect(parsed).toMatchObject({
      code: "puts 42",
      version: "4.0",
    });
    expect(parsed.warning).toContain("Ruby 4.0");
  });

  it.each(["", "%", "!!!", "A", "B", "zzzzzz", "Qgarbage", "Q$"])(
    "rejects invalid or truncated compressed data %j",
    (payload) => {
      const parsed = parseShareUrl(
        `https://ruby.example/?c=${encodeURIComponent(payload)}`,
        fallback,
      );
      expect(parsed.code).toBe(fallback);
      expect(parsed.warning).toBeTruthy();
    },
  );

  it("rejects excessive compressed input before decoding", () => {
    const parsed = parseShareUrl(
      `https://ruby.example/?c=${"A".repeat(MAX_COMPRESSED_LENGTH + 1)}`,
      fallback,
    );
    expect(parsed.code).toBe(fallback);
    expect(parsed.warning).toBeTruthy();
  });

  it("stops a highly expanding payload at the decoded source budget", () => {
    const payload = highExpansionPayload;
    const parsed = parseShareUrl(payload, fallback);
    expect(parsed.code).toBe(fallback);
    expect(parsed.warning).toContain("50,000");
  });

  it("rejects oversized source during share creation", () => {
    expect(() =>
      buildShareUrl(base, {
        code: "x".repeat(MAX_SOURCE_LENGTH + 1),
      }),
    ).toThrow("50,000");
  });

  it("returns a fallback for malformed URLs", () => {
    expect(parseShareUrl("not a url", fallback)).toMatchObject({
      code: fallback,
      warning: expect.any(String),
    });
  });

  it("replaces all existing sharing parameters, leaving other values intact", () => {
    const url = new URL(
      buildShareUrl(
        `${base.split("#")[0]}&c=old&c=duplicate&v=3&f=bad#anchor`,
        { code: "" },
      ),
    );
    expect(url.searchParams.getAll("c")).toHaveLength(1);
    expect(url.searchParams.has("f")).toBe(false);
    expect(url.searchParams.get("v")).toBe("4.0");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.hash).toBe("#anchor");
  });

  it("round trips a generated URL at the complete-URL byte limit", () => {
    const code = 'puts "ok"';
    const baseAtLimit = `https://ruby.example/${"p".repeat(MAX_SHARE_URL_BYTES - 180)}`;
    const url = buildShareUrl(baseAtLimit, { code });
    expect(new TextEncoder().encode(url).byteLength).toBeLessThanOrEqual(
      MAX_SHARE_URL_BYTES,
    );
    expect(parseShareUrl(url, fallback).code).toBe(code);
  });

  it("rejects an overlong complete URL without changing the source", () => {
    const code = 'puts "keep me"';
    const baseBeyondLimit = `https://ruby.example/${"p".repeat(MAX_SHARE_URL_BYTES)}`;
    expect(() => buildShareUrl(baseBeyondLimit, { code })).toThrow(
      "The code is too long to save in the URL",
    );
    expect(code).toBe('puts "keep me"');
  });

  it("round trips varied dictionary growth and UTF-16 sequences", () => {
    let seed = 123;
    let code = "";
    for (let i = 0; i < 12_000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      code += String.fromCharCode(seed >>> 16);
    }
    expect(parseShareUrl(encodedUrl(code), fallback).code).toBe(code);
  });
});

it.each(["4.0", "3.4", "3.3", "3.2", "4.1"] as const)(
  "preserves supported Ruby %s through a share URL",
  (version) => {
    const state = {
      code: "puts RUBY_VERSION",
      version,
    };
    expect(
      parseShareUrl(
        buildShareUrl("https://example.com/ruby-playground/?x=1#output", state),
        "",
      ),
    ).toEqual({ ...state, gemfile: "" });
  },
);
