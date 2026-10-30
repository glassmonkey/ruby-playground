import type { Lesson } from "../../schema";

/** Fresh, valid data; scenario-specific inputs stay in each test. */
export function validLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    slug: "sample",
    chapter: "Basics",
    title: "Display a value",
    goal: "Display a number",
    paragraphs: ["Use puts to display a value."],
    code: "puts 1",
    output: "1",
    pitfall: "Use puts to display the value.",
    refs: ["Kernel#puts"],
    remaining: "",
    experiments: [
      {
        id: "larger",
        title: "Larger value",
        task: "Display two",
        code: "puts 2",
        output: "2",
        answer: "puts displays two.",
      },
      {
        id: "sum",
        title: "Add values",
        task: "Add one and two",
        code: "puts 1 + 2",
        output: "3",
        answer: "The sum is three.",
      },
    ],
    ...overrides,
  };
}
