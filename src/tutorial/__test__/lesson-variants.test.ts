// @vitest-environment node
import { expect, it } from "vitest";
import { resolveLesson } from "../content";
import { RUBY_VERSIONS } from "../../versions";

// Introduction evidence: https://docs.ruby-lang.org/en/3.4/NEWS_md.html
// Language details: https://docs.ruby-lang.org/en/3.4/syntax/calling_methods_rdoc.html
// These expectations audit the lesson; real WASM execution is in seo.spec.ts.
const explicitExplanation =
  "Calling select and then map lets you filter entries before transforming them. Each method receives its own block. Name each block parameter explicitly, such as |count|. The final experiment uses a separate parameter in each block.";
const implicitExplanation =
  "Calling select and then map lets you filter entries before transforming them. Each method receives its own block. Ruby 3.4 introduced it as the implicit first block parameter when a block declares no parameters and no outer local variable named it takes precedence. The final experiment uses it in two separate blocks.";
const explicitCode =
  "counts = [0, 4, 1, 0, 3]\ntotals = counts.select { |count| count > 0 }.map { |count| count * 4 }\np totals";
const implicitCode =
  "counts = [0, 4, 1, 0, 3]\ntotals = counts.select { it > 0 }.map { it * 4 }\np totals";
const implicitNote =
  "The final experiment uses it, introduced in Ruby 3.4. You can also use an explicit block parameter such as |count|.";
const cases = [
  {
    version: "3.2",
    explanation: explicitExplanation,
    code: explicitCode,
    note: "Ruby 3.2 does not support the implicit it block parameter introduced in Ruby 3.4. This version uses explicit block parameters.",
  },
  {
    version: "3.3",
    explanation: explicitExplanation,
    code: explicitCode,
    note: "Ruby 3.3 does not support the implicit it block parameter introduced in Ruby 3.4. This version uses explicit block parameters.",
  },
  {
    version: "3.4",
    explanation: implicitExplanation,
    code: implicitCode,
    note: implicitNote,
  },
  {
    version: "4.0",
    explanation: implicitExplanation,
    code: implicitCode,
    note: implicitNote,
  },
  {
    version: "4.1",
    explanation: implicitExplanation,
    code: implicitCode,
    note: implicitNote,
  },
];
it("has an audited block-parameter lesson case for every registered version", () => {
  expect(cases.map((testCase) => testCase.version).sort()).toEqual(
    [...RUBY_VERSIONS].sort(),
  );
});
it.each(cases)(
  "Ruby $version pairs its block-parameter explanation with runnable syntax",
  ({ version, explanation, code, note }) => {
    const lesson = resolveLesson("enumerable", version)!;
    expect(lesson.paragraphs).toContain(explanation);
    expect({
      code: lesson.experiments.find((sample) => sample.id === "combine")?.code,
      note: lesson.versionNote,
    }).toEqual({ code, note });
  },
);
