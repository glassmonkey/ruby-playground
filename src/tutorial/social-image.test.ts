// @vitest-environment node
import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveLesson } from "./content";
import { renderSocialImage } from "./social-image";

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
