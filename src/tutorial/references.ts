import type { LessonContent } from "./content.ts";
import type { RUBY_RELEASES } from "../versions.ts";

type Release = (typeof RUBY_RELEASES)[number];
const syntax: Record<string, string> = {
  "Code Layout": "layout",
  Comments: "comments",
  Literals: "literals",
  Assignment: "assignment",
  Operators: "operators",
  Precedence: "precedence",
  "Control Expressions": "control_expressions",
  Methods: "methods",
  "Calling Methods": "calling_methods",
  "Modules and Classes": "modules_and_classes",
  Exceptions: "exceptions",
  "Pattern matching": "pattern_matching",
  Refinements: "refinements",
  Miscellaneous: "miscellaneous",
};
const overrides: Record<string, Record<string, string>> = {
  "3.2": { "Code Layout": "miscellaneous", Operators: "methods" },
  "3.3": { "Code Layout": "miscellaneous" },
  "3.4": { "Code Layout": "miscellaneous" },
};
const api = new Set([
  "Array",
  "BasicObject",
  "Class",
  "Enumerable",
  "FalseClass",
  "Float",
  "Hash",
  "Integer",
  "Kernel",
  "Module",
  "NilClass",
  "Numeric",
  "Object",
  "Proc",
  "Range",
  "String",
  "Symbol",
  "TrueClass",
]);
export function officialReferences(
  lesson: Pick<LessonContent, "refs">,
  release: Release,
) {
  return lesson.refs.map((name) => {
    if (name === "Ruby 3.4 release notes")
      return {
        label: "Ruby 3.4 release notes: introduction of the it block parameter",
        url: "https://docs.ruby-lang.org/en/3.4/NEWS_md.html",
      };
    const [owner, method] = name.split("#");
    const chapter = overrides[release.id]?.[name] ?? syntax[name];
    if (
      !chapter &&
      (!api.has(owner) || (method && !/^[A-Za-z_]+$/.test(method)))
    )
      throw new Error(`Unknown official reference: ${name}`);
    let label = name;
    if (name === "Code Layout" && chapter === "miscellaneous")
      label = "Miscellaneous Syntax (code layout)";
    if (name === "Operators" && chapter === "methods")
      label = "Methods (operator methods)";
    const page = chapter
      ? `syntax/${chapter}_rdoc.html`
      : `${owner}.html${method ? `#method-i-${method}` : ""}`;
    return {
      label: `Official ${release.label} documentation: ${label}`,
      url: `https://docs.ruby-lang.org/en/${release.reference}/${page}`,
    };
  });
}
