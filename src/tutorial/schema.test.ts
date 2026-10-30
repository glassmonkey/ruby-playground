// @vitest-environment node
import { ZodError } from "zod";
import { validLesson } from "./testing/lesson-fixture";
import { expect, it } from "vitest";
import { parseTutorialData, validateReferenceCatalog } from "./schema";
import lessons from "./data/lessons.json";
import chapters from "./data/chapters.json";
import redirects from "./data/redirects.json";
import { RUBY_VERSIONS } from "../versions";

it("accepts the published data without changing its meaning", () => {
  const data = { lessons, chapters, redirects };
  const want = structuredClone(data);
  const got = parseTutorialData(data, RUBY_VERSIONS);
  expect({ got, inputAfter: data }).toEqual({ got: want, inputAfter: want });
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
        { ...validLesson().experiments[0], task: "" },
        validLesson().experiments[1],
      ],
    },
    error: /Text must not be blank/,
  },
])("rejects $name before resolving versions", ({ change, error }) => {
  const data = {
    lessons: [{ ...validLesson(), ...change }],
    chapters: ["Basics"],
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
    lessons: [{ ...validLesson(), code: "\nputs __LINE__\n" }],
    chapters: ["Basics"],
    redirects: [],
  };
  const want = structuredClone(data);
  const got = parseTutorialData(data, RUBY_VERSIONS);
  expect({ got, inputAfter: data }).toEqual({ got: want, inputAfter: want });
});
it("rejects whitespace in a URL identity", () => {
  expect(() =>
    parseTutorialData(
      {
        lessons: [{ ...validLesson(), slug: " output " }],
        chapters: ["Basics"],
        redirects: [],
      },
      RUBY_VERSIONS,
    ),
  ).toThrow(ZodError);
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
