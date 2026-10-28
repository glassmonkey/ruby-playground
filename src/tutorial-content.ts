import content from "../content/tutorial.json" with { type: "json" };
import chapterCatalog from "../content/tutorial-chapters.json" with { type: "json" };
import { DEFAULT_RUBY_VERSION, RUBY_RELEASES } from "./versions.ts";

export type LessonExperiment = {
  id: string;
  title: string;
  task: string;
  code: string;
  output: string;
  answer: string;
};

export type LessonContent = {
  slug: string;
  title: string;
  chapter: string;
  goal: string;
  paragraphs: string[];
  code: string;
  output: string;
  experiments: LessonExperiment[];
  pitfall: string;
  refs: string[];
  remaining: string;
  versionNote?: string;
};
type Lesson = LessonContent & {
  variants?: Partial<
    Record<
      string,
      Partial<Omit<LessonContent, "slug" | "chapter">> & { available?: boolean }
    >
  >;
};
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
