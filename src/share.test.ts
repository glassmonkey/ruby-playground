import { describe, expect, it } from "vitest";
import { compressToEncodedURIComponent } from "lz-string";
import {
  buildShareUrl,
  MAX_COMPRESSED_LENGTH,
  MAX_SOURCE_LENGTH,
  parseShareUrl,
} from "./share";

const base = "https://ruby.example/playground?theme=dark#editor";
const fallback = 'puts "Fallback"';
const encodedUrl = (code: string) =>
  `https://ruby.example/?c=${encodeURIComponent(compressToEncodedURIComponent(code))}`;

describe("shared playground URLs", () => {
  it.each([
    "",
    'puts "Hello"\n',
    'puts "こんにちは 🌸"\n',
    "\u0000\ud800\uffff",
  ])("round trips source %j and HTML mode", (code) => {
    const url = buildShareUrl(base, { code, version: "4.0", format: "html" });
    expect(parseShareUrl(url, fallback)).toEqual({
      code,
      version: "4.0",
      format: "html",
    });
    expect(new URL(url).searchParams.get("theme")).toBe("dark");
    expect(new URL(url).hash).toBe("#editor");
  });

  it("reads lz-string URI payloads produced independently", () => {
    const code = 'puts "Ruby"\n'.repeat(400);
    expect(parseShareUrl(encodedUrl(code), fallback).code).toBe(code);
  });

  it("accepts the exact source length boundary", () => {
    const code = "あ".repeat(MAX_SOURCE_LENGTH);
    expect(
      parseShareUrl(buildShareUrl(base, { code, format: "console" }), fallback)
        .code,
    ).toBe(code);
  });

  it("uses fallback without warnings when no sharing parameters exist", () => {
    expect(parseShareUrl(base, fallback)).toEqual({
      code: fallback,
      version: "4.0",
      format: "console",
    });
  });

  it("normalizes unsupported version and format without losing valid code", () => {
    const parsed = parseShareUrl(
      `${encodedUrl("puts 42")}&v=3.3&f=javascript`,
      fallback,
    );
    expect(parsed).toMatchObject({
      code: "puts 42",
      version: "4.0",
      format: "console",
    });
    expect(parsed.warning).toContain("Ruby 4.0");
    expect(parsed.warning).toContain("Unknown output format");
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
    const payload = encodedUrl("x".repeat(1_000_000));
    const parsed = parseShareUrl(payload, fallback);
    expect(parsed.code).toBe(fallback);
    expect(parsed.warning).toContain("50,000");
  });

  it("rejects oversized source during share creation", () => {
    expect(() =>
      buildShareUrl(base, {
        code: "x".repeat(MAX_SOURCE_LENGTH + 1),
        format: "console",
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
        { code: "", format: "console" },
      ),
    );
    expect(url.searchParams.getAll("c")).toHaveLength(1);
    expect(url.searchParams.get("v")).toBe("4.0");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.hash).toBe("#anchor");
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
