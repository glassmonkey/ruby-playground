// @vitest-environment node
import { expect, it } from "vitest";
import { officialReferences } from "./references";
import { RUBY_RELEASES } from "../versions";

it.each(["toString", "constructor", "__proto__", "Kernel#puts#extra"])(
  "rejects unknown reference %s",
  (name) => {
    expect(() =>
      officialReferences(
        { refs: [name] },
        RUBY_RELEASES.find((release) => release.id === "4.0")!,
      ),
    ).toThrow(/Unknown official reference/);
  },
);
it("resolves a catalog reference", () => {
  expect(
    officialReferences(
      { refs: ["Kernel#puts"] },
      RUBY_RELEASES.find((release) => release.id === "4.0")!,
    ),
  ).toEqual([
    {
      label: `Official ${RUBY_RELEASES.find((release) => release.id === "4.0")!.label} documentation: Kernel#puts`,
      url: `https://docs.ruby-lang.org/en/${RUBY_RELEASES.find((release) => release.id === "4.0")!.reference}/Kernel.html#method-i-puts`,
    },
  ]);
});

it.each([
  {
    version: "3.2",
    name: "Code Layout",
    label:
      "Official Ruby 3.2 documentation: Miscellaneous Syntax (code layout)",
    url: "https://docs.ruby-lang.org/en/3.2/syntax/miscellaneous_rdoc.html",
  },
  {
    version: "4.0",
    name: "Code Layout",
    label: "Official Ruby 4.0 documentation: Code Layout",
    url: "https://docs.ruby-lang.org/en/4.0/syntax/layout_rdoc.html",
  },
  {
    version: "4.1",
    name: "Methods",
    label: "Official Ruby 4.1 development documentation: Methods",
    url: "https://docs.ruby-lang.org/en/master/syntax/methods_rdoc.html",
  },
  {
    version: "4.0",
    name: "Ruby 3.4 release notes",
    label: "Ruby 3.4 release notes: introduction of the it block parameter",
    url: "https://docs.ruby-lang.org/en/3.4/NEWS_md.html",
  },
])(
  "resolves $version $name with its documented version semantics",
  ({ version, name, label, url }) => {
    const release = RUBY_RELEASES.find((release) => release.id === version)!;
    expect(officialReferences({ refs: [name] }, release)).toEqual([
      { label, url },
    ]);
  },
);
