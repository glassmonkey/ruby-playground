import { z } from "zod";

const text = z
  .string()
  .refine((value) => value.trim().length > 0, "Text must not be blank");
const id = text.regex(/^[a-z0-9-]+$/);
const experiment = z.strictObject({
  id,
  title: text,
  task: text,
  code: text,
  output: z.string(),
  answer: text,
});
const fields = {
  title: text,
  goal: text,
  paragraphs: z.array(text).min(1),
  code: text,
  output: z.string(),
  experiments: z.array(experiment).min(2).max(3),
  pitfall: text,
  refs: z.array(text).min(1),
  remaining: z.string(),
  versionNote: text.optional(),
};
const variant = z
  .strictObject(fields)
  .partial()
  .extend({ available: z.boolean().optional() });
export const lessonSchema = z.strictObject({
  slug: id,
  chapter: text,
  ...fields,
  variants: z.record(text, variant).optional(),
});
export const tutorialDataSchema = z.strictObject({
  chapters: z.array(text).min(1),
  lessons: z.array(lessonSchema).min(1),
  redirects: z.array(z.strictObject({ slug: id, redirectTo: id })),
});
export type Lesson = z.infer<typeof lessonSchema>;
export type LessonContent = Omit<Lesson, "variants">;
export type LessonExperiment = LessonContent["experiments"][number];

/** Validate raw input before resolution can hide unknown or unavailable entries. */
export function parseTutorialData(input: unknown, versions: readonly string[]) {
  const data = tutorialDataSchema.parse(input);
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length)
      throw new Error(`Duplicate ${label}`);
  };
  unique(data.chapters, "chapter");
  unique(
    data.lessons.map((lesson) => lesson.slug),
    "lesson ID",
  );
  unique(
    data.redirects.map((redirect) => redirect.slug),
    "redirect ID",
  );
  const slugs = new Set(data.lessons.map((lesson) => lesson.slug));
  for (const lesson of data.lessons) {
    if (!data.chapters.includes(lesson.chapter))
      throw new Error(`Unknown chapter: ${lesson.slug}`);
    for (const version of Object.keys(lesson.variants ?? {}))
      if (!versions.includes(version))
        throw new Error(`Unknown variant version: ${lesson.slug}/${version}`);
    unique(
      lesson.experiments.map((experiment) => experiment.id),
      `experiment ID: ${lesson.slug}`,
    );
    for (const [version, variant] of Object.entries(lesson.variants ?? {}))
      if (variant.experiments)
        unique(
          variant.experiments.map((experiment) => experiment.id),
          `experiment ID: ${lesson.slug}/${version}`,
        );
  }
  for (const redirect of data.redirects)
    if (slugs.has(redirect.slug) || !slugs.has(redirect.redirectTo))
      throw new Error(`Invalid successor: ${redirect.slug}`);
  return data;
}

const page = z.string().regex(/^[a-z_]+$/);
export const referenceCatalogSchema = z.strictObject({
  syntax: z.record(text, page),
  overrides: z.record(text, z.record(text, page)),
  api: z.array(text.regex(/^[A-Z][A-Za-z0-9]*$/)),
  external: z.record(
    text,
    z.strictObject({ label: text, url: z.url().startsWith("https://") }),
  ),
});
export function validateReferenceCatalog(
  input: unknown,
  versions: readonly string[],
) {
  const catalog = referenceCatalogSchema.parse(input);
  for (const [version, entries] of Object.entries(catalog.overrides)) {
    if (!versions.includes(version))
      throw new Error(`Unknown reference version: ${version}`);
    for (const key of Object.keys(entries))
      if (!Object.hasOwn(catalog.syntax, key))
        throw new Error(`Unknown syntax override: ${key}`);
  }
  return catalog;
}
