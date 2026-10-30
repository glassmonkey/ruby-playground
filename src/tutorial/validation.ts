import {
  chaptersForVersion,
  lessonsForVersion,
  tutorialSlugs,
  tutorialVersions,
  resolveLesson,
} from "./content.ts";
import catalog from "./data/references.json" with { type: "json" };
import { parseTutorialData, validateReferenceCatalog } from "./schema.ts";
import rawLessons from "./data/lessons.json" with { type: "json" };
import rawChapters from "./data/chapters.json" with { type: "json" };
import redirects from "./data/redirects.json" with { type: "json" };
import { officialReferences } from "./references.ts";

export function validateTutorialData(): void {
  validateReferenceCatalog(
    catalog,
    tutorialVersions.map((version) => version.id),
  );
  parseTutorialData(
    { lessons: rawLessons, chapters: rawChapters, redirects },
    tutorialVersions.map((version) => version.id),
  );
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
      officialReferences(lesson, version);
    }
  }
}
