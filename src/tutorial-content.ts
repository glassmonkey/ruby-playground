import content from "../content/tutorial.json" with { type: "json" };
import catalog from "../content/tutorial-versions.json" with { type: "json" };

export type LessonContent = {
  slug: string;
  title: string;
  chapter: string;
  goal: string;
  paragraphs: string[];
  code: string;
  output: string;
  task: string;
  answer: string;
  pitfall: string;
  refs: string[];
  remaining: string;
  versionNote?: string;
};
type Lesson = LessonContent & {
  variants?: Record<
    string,
    Partial<Omit<LessonContent, "slug">> & { available?: boolean }
  >;
};
const lessons: Lesson[] = content;
export const tutorialVersions = catalog.versions;
export const latestTutorialVersion = catalog.latest;
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
export function lessonsForVersion(version: string): LessonContent[] {
  return tutorialSlugs.flatMap((slug) => {
    const lesson = resolveLesson(slug, version);
    return lesson ? [lesson] : [];
  });
}
