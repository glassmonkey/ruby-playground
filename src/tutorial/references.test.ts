// @vitest-environment node
import { expect, it } from "vitest";
import { officialReferences } from "./references";
import { RUBY_RELEASES } from "../versions";

it.each(["toString", "constructor", "__proto__", "Kernel#puts#extra"])(
  "rejects unknown reference %s",
  (name) => {
    expect(() =>
      officialReferences({ refs: [name] }, RUBY_RELEASES[0]),
    ).toThrow(/Unknown official reference/);
  },
);
it("resolves a catalog reference", () => {
  expect(
    officialReferences({ refs: ["Kernel#puts"] }, RUBY_RELEASES[0]),
  ).toEqual([
    {
      label: `Official ${RUBY_RELEASES[0].label} documentation: Kernel#puts`,
      url: `https://docs.ruby-lang.org/en/${RUBY_RELEASES[0].reference}/Kernel.html#method-i-puts`,
    },
  ]);
});
