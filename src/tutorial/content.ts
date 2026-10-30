import content from "./data/lessons.json" with { type: "json" };
import chapterCatalog from "./data/chapters.json" with { type: "json" };
import { DEFAULT_RUBY_VERSION, RUBY_RELEASES } from "../versions.ts";

import type { Lesson, LessonContent } from "./schema.ts";
export type { LessonContent, LessonExperiment } from "./schema.ts";
const lessons: Lesson[] = content;
export const tutorialVersions = RUBY_RELEASES;
export const latestTutorialVersion = DEFAULT_RUBY_VERSION;
export const tutorialSlugs = lessons.map((lesson) => lesson.slug);
export function lessonPath(version: string, slug: string): string {
  return `/tutorial/${version}/${slug}/`;
}
export function resolveLesson(
  slug: string,
  version: string,
): LessonContent | undefined {
  if (!tutorialVersions.some((item) => item.id === version)) return undefined;
  const base = lessons.find((item) => item.slug === slug);
  if (!base) return undefined;
  const { variants, ...shared } = base;
  const { available = true, ...changes } = variants?.[version] ?? {};
  return available ? { ...shared, ...changes } : undefined;
}
export function chaptersForVersion(version: string): string[] {
  return tutorialVersions.some((item) => item.id === version)
    ? [...chapterCatalog]
    : [];
}
export function lessonsForVersion(version: string): LessonContent[] {
  const chapters = chaptersForVersion(version);
  return tutorialSlugs
    .flatMap((slug) => {
      const lesson = resolveLesson(slug, version);
      return lesson ? [lesson] : [];
    })
    .sort((a, b) => chapters.indexOf(a.chapter) - chapters.indexOf(b.chapter));
}
