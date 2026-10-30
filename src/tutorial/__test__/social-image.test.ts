// @vitest-environment node
import { describe, expect, it } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { resolveLesson } from "../content";
import { RUBY_VERSIONS } from "../../versions";
import { renderSocialImage } from "../social-image";

const fontFile = path.resolve("assets/fonts/plus-jakarta-sans.ttf");

describe("lesson social images", () => {
  it.each(["title", "code"] as const)(
    "reflects a change in resolved lesson %s",
    (field) => {
      const lesson = resolveLesson("output", "4.0")!;
      const original = renderSocialImage("4.0", lesson, fontFile);
      const updated = renderSocialImage(
        "4.0",
        { ...lesson, [field]: 'New <Ruby> & "example"' },
        fontFile,
      );
      expect(updated.equals(original)).toBe(false);
    },
  );
  it("distinguishes Ruby versions using the same lesson data", () => {
    const lesson = resolveLesson("output", "4.0")!;
    expect(
      renderSocialImage("3.2", lesson, fontFile).equals(
        renderSocialImage("4.0", lesson, fontFile),
      ),
    ).toBe(false);
  });
});

// Fixed course cards isolate release labels from future lesson additions.
// These PNGs require visual approval when fonts or the renderer change.
const approvedCards = [
  { version: "4.0", snapshot: "./__snapshots__/course-4.0.png" },
  { version: "3.4", snapshot: "./__snapshots__/course-3.4.png" },
  { version: "3.3", snapshot: "./__snapshots__/course-3.3.png" },
  { version: "3.2", snapshot: "./__snapshots__/course-3.2.png" },
  { version: "4.1", snapshot: "./__snapshots__/development-card.png" },
] as const;
it("has a visually approved image expectation for every registered release", () => {
  expect(approvedCards.map((card) => card.version).sort()).toEqual(
    [...RUBY_VERSIONS].sort(),
  );
});
it.each(approvedCards)(
  "renders the approved Ruby $version course card and release badge",
  ({ version, snapshot }) => {
    const want = readFileSync(new URL(snapshot, import.meta.url));
    expect(renderSocialImage(version, undefined, fontFile).equals(want)).toBe(
      true,
    );
  },
);
