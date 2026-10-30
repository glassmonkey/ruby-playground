import type { LessonContent } from "./content.ts";
import type { RUBY_RELEASES } from "../versions.ts";

type Release = (typeof RUBY_RELEASES)[number];
import catalog from "./data/references.json" with { type: "json" };
const syntax: Record<string, string> = catalog.syntax;
const overrides: Record<string, Record<string, string>> = catalog.overrides;
const external: Record<string, { label: string; url: string }> =
  catalog.external;
const api = new Set(catalog.api);
export function officialReferences(
  lesson: Pick<LessonContent, "refs">,
  release: Release,
) {
  return lesson.refs.map((name) => {
    if (Object.hasOwn(external, name)) return external[name];
    const [owner, method, extra] = name.split("#");
    if (extra !== undefined)
      throw new Error(`Unknown official reference: ${name}`);
    const versionOverrides = Object.hasOwn(overrides, release.id)
      ? overrides[release.id]
      : undefined;
    const chapter =
      versionOverrides && Object.hasOwn(versionOverrides, name)
        ? versionOverrides[name]
        : Object.hasOwn(syntax, name)
          ? syntax[name]
          : undefined;
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
