import {
  chaptersForVersion,
  lessonsForVersion,
  tutorialSlugs,
  tutorialVersions,
  resolveLesson,
} from "./content.ts";
import redirects from "./data/redirects.json" with { type: "json" };
import { officialReferences } from "./references.ts";

export function validateTutorialData(): void {
  if (
    new Set(tutorialSlugs).size !== tutorialSlugs.length ||
    tutorialSlugs.some((slug) => !/^[a-z0-9-]+$/.test(slug))
  )
    throw new Error("Lesson IDs must be unique URL-safe identifiers");
  for (const { slug, redirectTo } of redirects) {
    if (tutorialSlugs.includes(slug) || !tutorialSlugs.includes(redirectTo))
      throw new Error(`Invalid successor for ${slug}`);
  }
  for (const version of tutorialVersions) {
    const chapters = chaptersForVersion(version.id);
    if (!lessonsForVersion(version.id).length)
      throw new Error(`Empty course for ${version.id}`);
    for (const slug of tutorialSlugs) {
      const lesson = resolveLesson(slug, version.id);
      if (!lesson) continue;
      const where = `${version.id}/${slug}`;
      if (!chapters.includes(lesson.chapter))
        throw new Error(`Unknown chapter: ${where}`);
      for (const field of ["title", "goal", "code"] as const)
        if (typeof lesson[field] !== "string" || !lesson[field].length)
          throw new Error(`Missing ${field}: ${where}`);
      if (typeof lesson.output !== "string")
        throw new Error(`Missing output: ${where}`);
      if (
        !lesson.paragraphs.length ||
        lesson.paragraphs.some(
          (text) => typeof text !== "string" || !text.trim(),
        )
      )
        throw new Error(`Invalid explanation: ${where}`);
      if (
        lesson.experiments.length < 2 ||
        lesson.experiments.length > 3 ||
        new Set(lesson.experiments.map((e) => e.id)).size !==
          lesson.experiments.length
      )
        throw new Error(`Expected two or three distinct experiments: ${where}`);
      for (const experiment of lesson.experiments) {
        if (!/^[a-z0-9-]+$/.test(experiment.id))
          throw new Error(`Invalid experiment ID: ${where}`);
        for (const field of [
          "title",
          "task",
          "code",
          "output",
          "answer",
        ] as const)
          if (typeof experiment[field] !== "string")
            throw new Error(`Missing experiment ${field}: ${where}`);
      }
      if (!lesson.refs.length) throw new Error(`Missing references: ${where}`);
      officialReferences(lesson, version);
    }
  }
}
