// @vitest-environment node
import { expect, it } from "vitest";
import { parseTutorialData, validateReferenceCatalog } from "./schema";
import lessons from "./data/lessons.json";
import chapters from "./data/chapters.json";
import redirects from "./data/redirects.json";
import { RUBY_VERSIONS } from "../versions";

it("accepts the published data without changing its meaning", () => {
  const data = { lessons, chapters, redirects };
  expect(parseTutorialData(data, RUBY_VERSIONS)).toEqual(data);
});
it.each([
  {
    name: "unknown version",
    change: { variants: { typo: { available: false } } },
    error: /Unknown variant version/,
  },
  {
    name: "unknown chapter",
    change: { chapter: "Missing" },
    error: /Unknown chapter/,
  },
  {
    name: "identity override",
    change: { variants: { "4.0": { slug: "renamed" } } },
    error: /Unrecognized key/,
  },
  {
    name: "invalid availability",
    change: { variants: { "4.0": { available: "false" } } },
    error: /boolean/,
  },
  {
    name: "empty task",
    change: {
      experiments: [
        { ...lessons[0].experiments[0], task: "" },
        lessons[0].experiments[1],
      ],
    },
    error: /Text must not be blank/,
  },
])("rejects $name before resolving versions", ({ change, error }) => {
  const data = {
    lessons: [{ ...lessons[0], ...change }],
    chapters,
    redirects: [],
  };
  expect(() => parseTutorialData(data, RUBY_VERSIONS)).toThrow(error);
});
it("rejects duplicate chapters", () => {
  expect(() =>
    parseTutorialData(
      { lessons, chapters: [...chapters, chapters[0]], redirects },
      RUBY_VERSIONS,
    ),
  ).toThrow(/Duplicate chapter/);
});
it("rejects an unresolved successor", () => {
  expect(() =>
    parseTutorialData(
      {
        lessons,
        chapters,
        redirects: [{ slug: "old", redirectTo: "missing" }],
      },
      RUBY_VERSIONS,
    ),
  ).toThrow(/Invalid successor/);
});

it("preserves code whitespace and line numbers", () => {
  const data = {
    lessons: [{ ...lessons[0], code: "\nputs __LINE__\n" }],
    chapters,
    redirects: [],
  };
  expect(parseTutorialData(data, RUBY_VERSIONS)).toEqual(data);
});
it("rejects whitespace in a URL identity", () => {
  expect(() =>
    parseTutorialData(
      {
        lessons: [{ ...lessons[0], slug: " output " }],
        chapters,
        redirects: [],
      },
      RUBY_VERSIONS,
    ),
  ).toThrow();
});

it.each([
  {
    overrides: { typo: { Comments: "comments" } },
    error: /Unknown reference version/,
  },
  {
    overrides: { "4.0": { Missing: "comments" } },
    error: /Unknown syntax override/,
  },
])("rejects invalid catalog relationships", ({ overrides, error }) => {
  expect(() =>
    validateReferenceCatalog(
      { syntax: { Comments: "comments" }, overrides, api: [], external: {} },
      RUBY_VERSIONS,
    ),
  ).toThrow(error);
});
