// @vitest-environment node
import { expect, it, vi } from "vitest";

vi.mock("./data/chapters.json", () => ({
  default: ["Basics", "Applications"],
}));
vi.mock("./data/lessons.json", async () => {
  const { validLesson } = await import("./testing/lesson-fixture");
  return {
    default: [
      validLesson({
        slug: "application",
        chapter: "Applications",
        title: "Apply",
        code: "puts 3",
        paragraphs: ["Apply it"],
        variants: {
          "3.2": {
            paragraphs: ["Older explanation"],
            experiments: [
              {
                id: "older-a",
                title: "Add",
                task: "Add two and one",
                code: "puts 2 + 1",
                output: "3",
                answer: "The sum is three.",
              },
              {
                id: "older-b",
                title: "Subtract",
                task: "Subtract one",
                code: "puts 3 - 1",
                output: "2",
                answer: "Two remains.",
              },
            ],
          },
        },
      }),
      validLesson({
        slug: "first",
        title: "Begin",
        code: "puts 1",
        paragraphs: ["Begin here"],
      }),
      validLesson({
        slug: "second",
        title: "Continue",
        code: "puts 2",
        paragraphs: ["Continue here"],
        variants: { "3.2": { available: false } },
      }),
    ],
  };
});
import { lessonsForVersion, resolveLesson } from "./content";

it("orders by chapter catalog then preserves lesson order within each chapter", () => {
  expect(lessonsForVersion("4.0").map((lesson) => lesson.slug)).toEqual([
    "first",
    "second",
    "application",
  ]);
});
it("inherits shared fields and samples when no variant is defined", () => {
  const lesson = resolveLesson("first", "3.2")!;
  expect({
    title: lesson.title,
    code: lesson.code,
    paragraphs: lesson.paragraphs,
    experiments: lesson.experiments.map((sample) => sample.id),
  }).toEqual({
    title: "Begin",
    code: "puts 1",
    paragraphs: ["Begin here"],
    experiments: ["larger", "sum"],
  });
});
it("replaces variant arrays completely while inheriting unspecified fields", () => {
  const lesson = resolveLesson("application", "3.2")!;
  expect({
    title: lesson.title,
    code: lesson.code,
    paragraphs: lesson.paragraphs,
    experiments: lesson.experiments.map((sample) => sample.id),
  }).toEqual({
    title: "Apply",
    code: "puts 3",
    paragraphs: ["Older explanation"],
    experiments: ["older-a", "older-b"],
  });
});
it("excludes unavailable lessons while retaining inherited ones", () => {
  expect({
    missing: resolveLesson("second", "3.2"),
    listed: lessonsForVersion("3.2").map((lesson) => lesson.slug),
  }).toEqual({ missing: undefined, listed: ["first", "application"] });
});
