import { describe, expect, it } from "vitest";
import { GEM_FILE, GEM_NAME } from "./gem-name";

describe("gem names", () => {
  it.each([
    ["rainbow", true],
    ["ruby_parser", true],
    ["net-http-persistent", true],
    ["RedCloth", true],
    ["concurrent-ruby", true],
    ["i18n", true],
    ["123", false], // must include at least one letter
    ["-rainbow", false], // cannot begin with a dash
    [".rainbow", false], // cannot begin with a period
    ["_rainbow", false], // cannot begin with an underscore
    ["..", false],
    ["rain bow", false], // only letters, digits, ".", "-" and "_"
    ["rain/bow", false],
    ["", false],
  ])("treats %j as valid: %j", (name, valid) => {
    expect(GEM_NAME.test(name)).toBe(valid);
  });
});

describe("gem files", () => {
  it.each([
    ["rainbow-3.1.1.gem", true],
    ["nokogiri-1.19.4-x86_64-linux-gnu.gem", true],
    ["RedCloth-4.3.4.gem", true],
    ["123-1.0.0.gem", false],
    ["-rainbow-3.1.1.gem", false],
    ["rainbow-3.1.1", false],
    ["rainbow-3.1.1.gem.zip", false],
  ])("treats %j as valid: %j", (file, valid) => {
    expect(GEM_FILE.test(file)).toBe(valid);
  });
});
