import { describe, expect, it } from "vitest";
import {
  extensionIssueUrl,
  missingExtension,
  missingRequire,
  searchUrl,
} from "../missing-require";

const loadError = (feature: string) =>
  `eval:1:in 'Kernel#require': cannot load such file -- ${feature} (LoadError)`;

describe("missingRequire", () => {
  it.each([
    ['require "faker"', "faker", "faker"],
    [
      "require('active_support/all')",
      "active_support/all",
      "active_support/all",
    ],
    ['require "faker"', "i18n", undefined],
    ['require "bigdecimal"', "bigdecimal.so", undefined],
    ['require_relative "faker"', "faker", undefined],
  ])("reads %j failing on %j as %j", (code, feature, want) => {
    expect(missingRequire(loadError(feature), code)).toBe(want);
  });
  it("ignores runs without a LoadError", () => {
    expect(missingRequire(undefined, 'require "faker"')).toBeUndefined();
  });
});

describe("searchUrl", () => {
  it("turns slashes into spaces for the rubygems.org search", () => {
    expect(searchUrl("rack/test")).toBe(
      "https://rubygems.org/search?query=rack%20test",
    );
  });
});

describe("missingExtension", () => {
  it("names the gem that asked for a native extension", () => {
    const error =
      "/gems/installed/bigdecimal-4.1.3/lib/bigdecimal.rb:10:in 'Kernel#require': cannot load such file -- bigdecimal.so (LoadError)\n" +
      "/gems/installed/activesupport-8.1.4/lib/active_support/core_ext/big_decimal/conversions.rb:3:in 'Kernel#require'";
    const found = missingExtension(error);
    expect({ found, issue: found && extensionIssueUrl(found) }).toEqual({
      found: {
        extension: "bigdecimal.so",
        gem: { name: "bigdecimal", version: "4.1.3" },
      },
      issue:
        "https://github.com/glassmonkey/ruby-playground/issues/new?title=Support%20the%20bigdecimal%20gem%20(native%20extension)",
    });
  });
  it.each([
    [loadError("faker"), undefined],
    [undefined, undefined],
    [loadError("nokogiri/nokogiri.so"), { extension: "nokogiri/nokogiri.so" }],
  ])("reads %j as %j", (error, want) => {
    expect(missingExtension(error)).toEqual(want);
  });
});
