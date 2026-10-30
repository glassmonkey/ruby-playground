// @vitest-environment node
import { expect, it } from "vitest";
import { officialReferences } from "./references";
import { RUBY_RELEASES, RUBY_VERSIONS } from "../versions";

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
const referenceCases = [
  {
    version: "4.0",
    name: "Kernel#puts",
    label: "Official Ruby 4.0 documentation: Kernel#puts",
    url: "https://docs.ruby-lang.org/en/4.0/Kernel.html#method-i-puts",
  },
  {
    version: "3.4",
    name: "Kernel#puts",
    label: "Official Ruby 3.4 documentation: Kernel#puts",
    url: "https://docs.ruby-lang.org/en/3.4/Kernel.html#method-i-puts",
  },
  {
    version: "3.3",
    name: "Kernel#puts",
    label: "Official Ruby 3.3 documentation: Kernel#puts",
    url: "https://docs.ruby-lang.org/en/3.3/Kernel.html#method-i-puts",
  },
  {
    version: "3.2",
    name: "Kernel#puts",
    label: "Official Ruby 3.2 documentation: Kernel#puts",
    url: "https://docs.ruby-lang.org/en/3.2/Kernel.html#method-i-puts",
  },
  {
    version: "4.1",
    name: "Kernel#puts",
    label: "Official Ruby 4.1 development documentation: Kernel#puts",
    url: "https://docs.ruby-lang.org/en/master/Kernel.html#method-i-puts",
  },
  {
    version: "3.3",
    name: "Code Layout",
    label:
      "Official Ruby 3.3 documentation: Miscellaneous Syntax (code layout)",
    url: "https://docs.ruby-lang.org/en/3.3/syntax/miscellaneous_rdoc.html",
  },
  {
    version: "3.4",
    name: "Code Layout",
    label:
      "Official Ruby 3.4 documentation: Miscellaneous Syntax (code layout)",
    url: "https://docs.ruby-lang.org/en/3.4/syntax/miscellaneous_rdoc.html",
  },
  {
    version: "3.2",
    name: "Operators",
    label: "Official Ruby 3.2 documentation: Methods (operator methods)",
    url: "https://docs.ruby-lang.org/en/3.2/syntax/methods_rdoc.html",
  },
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
];
it("covers ordinary API links for every registered version", () => {
  expect(
    referenceCases
      .filter((testCase) => testCase.name === "Kernel#puts")
      .map((testCase) => testCase.version)
      .sort(),
  ).toEqual([...RUBY_VERSIONS].sort());
});
it.each(referenceCases)(
  "resolves $version $name with its documented version semantics",
  ({ version, name, label, url }) => {
    const release = RUBY_RELEASES.find((release) => release.id === version)!;
    expect(officialReferences({ refs: [name] }, release)).toEqual([
      { label, url },
    ]);
  },
);
