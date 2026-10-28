import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import lz from "lz-string";
import {
  tutorialVersions,
  latestTutorialVersion,
  tutorialSlugs,
  lessonsForVersion,
  resolveLesson,
  lessonPath,
} from "../src/tutorial-content.ts";
import { RUBY_VERSIONS } from "../src/versions.ts";
const root = new URL("../", import.meta.url);
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const latest = tutorialVersions.find(
  (version) => version.id === latestTutorialVersion,
);
if (!latest || latest.channel !== "stable")
  throw new Error("Tutorial latest must select a supported stable version.");
if (
  new Set(tutorialSlugs).size !== tutorialSlugs.length ||
  tutorialSlugs.some((slug) => !/^[a-z0-9-]+$/.test(slug))
)
  throw new Error("Tutorial slugs must be unique URL-safe identifiers.");
for (const version of tutorialVersions) {
  if (!RUBY_VERSIONS.includes(version.id))
    throw new Error(`No bundled runtime for tutorial ${version.id}`);
}
const newestStable = tutorialVersions
  .filter((version) => version.channel === "stable")
  .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))
  .at(-1);
if (latest.id !== newestStable?.id)
  throw new Error(
    "Tutorial latest must be the newest supported stable course.",
  );
const syntax = {
  "Code Layout": "layout",
  Comments: "comments",
  Literals: "literals",
  Assignment: "assignment",
  Operators: "operators",
  Precedence: "precedence",
  "Control Expressions": "control_expressions",
  Methods: "methods",
  "Calling Methods": "calling_methods",
  "Modules and Classes": "modules_and_classes",
  Exceptions: "exceptions",
  "Pattern matching": "pattern_matching",
  Refinements: "refinements",
  Miscellaneous: "miscellaneous",
};
// Older references group layout/operator material under different chapter names.
const referenceOverrides = {
  3.2: { "Code Layout": "miscellaneous", Operators: "methods" },
  3.3: { "Code Layout": "miscellaneous" },
  3.4: { "Code Layout": "miscellaneous" },
};
const source = (name, version) => {
  const chapter = referenceOverrides[version.id]?.[name] ?? syntax[name];
  return `https://docs.ruby-lang.org/en/${version.reference}/${chapter ? `syntax/${chapter}_rdoc` : name}.html`;
};
const style = readFileSync(
  new URL("../content/tutorial.css", import.meta.url),
  "utf8",
);
const coursePath = (version) => `/tutorial/${version.id}/`;
const versionLabel = (version) => version.label;
const link = (lesson, version) =>
  `<a href="${lessonPath(version.id, lesson.slug)}">${escape(lesson.title)}</a>`;
function versionNavigation(version, slug) {
  return `<nav class="version-navigation" aria-label="Tutorial versions">${tutorialVersions.map((item) => `<a ${item.id === version.id ? 'aria-current="page"' : ""} href="${slug ? lessonPath(item.id, slug) : coursePath(item)}">${escape(item.label)}</a>`).join("")}</nav>`;
}
function page(url, title, description, body, { noindex = false } = {}) {
  const [, , versionId, slug] = url.split("/");
  const version = tutorialVersions.find((item) => item.id === versionId);
  const themeScript = `try{const m=localStorage.getItem("chakra-ui-color-mode");document.documentElement.dataset.theme=m==="dark"||m==="light"?m:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch{}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} – Ruby Playground</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="https://ruby-play.dev${url}">${noindex ? '<meta name="robots" content="noindex">' : ""}<link rel="icon" href="/favicon.svg"><script>${themeScript}</script><link rel="stylesheet" href="/tutorial.css"></head><body data-course-version="${version.id}" data-current-lesson="${slug || ""}"><header><a href="/">Ruby Playground</a><a href="/tutorial/">Ruby Tutorial</a><div id="tutorial-header-controls" data-version="${version.id}" data-lesson="${slug || ""}">${versionNavigation(version, slug)}</div></header><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/tutorial/">Tutorial</a><span>›</span><a href="${coursePath(version)}">${escape(version.label)}</a>${slug ? `<span>›</span><span>${escape(resolveLesson(slug, version.id)?.title ?? "Lesson")}</span>` : ""}</nav><main>${body}</main><footer><a href="/">Open the playground</a> · <a href="/tutorial/">Choose a tutorial version</a></footer><script type="module" src="/src/tutorial.tsx"></script></body></html>`;
}
function write(relative, text) {
  const url = new URL(relative, root);
  mkdirSync(new URL("./", url), { recursive: true });
  writeFileSync(url, text);
}
function redirect(relative, destination) {
  write(
    relative,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${destination}"><link rel="canonical" href="https://ruby-play.dev${destination}"><title>Ruby Tutorial – Ruby Playground</title></head><body><p>Continue to the <a href="${destination}">Ruby tutorial</a>.</p></body></html>`,
  );
}
write("assets/tutorial.css", style);
// This directory contains generated pages only; remove stale routes when lessons change.
rmSync(new URL("tutorial/", root), { recursive: true, force: true });
const sitemap = ["/"];
for (const version of tutorialVersions) {
  const lessons = lessonsForVersion(version.id);
  const chapters = [...new Set(lessons.map((lesson) => lesson.chapter))];
  for (const slug of tutorialSlugs) {
    const lesson = resolveLesson(slug, version.id);
    const url = lessonPath(version.id, slug);
    if (!lesson) {
      write(
        `tutorial/${version.id}/${slug}/index.html`,
        page(
          url,
          `Lesson unavailable in ${version.label}`,
          `This topic is not taught in ${version.label}.`,
          `<h1>This lesson is not available in ${escape(version.label)}</h1><p>Choose another version above or <a href="${coursePath(version)}">return to this course</a>.</p>`,
          { noindex: true },
        ),
      );
      continue;
    }
    const i = lessons.findIndex((item) => item.slug === slug);
    const share = `/?c=${encodeURIComponent(lz.compressToEncodedURIComponent(lesson.code))}&v=${version.id}#editor-heading`;
    const sidebar = `<aside class="course-sidebar"><details open><summary>Course contents</summary><div class="course-progress"><p data-progress-summary>0 of ${lessons.length} completed</p><progress data-progress-bar max="${lessons.length}" value="0" aria-label="Course progress"></progress></div><nav aria-label="Course contents">${lessons.map((item, index) => `<a data-lesson-link="${item.slug}" ${item.slug === slug ? 'aria-current="page"' : ""} href="${lessonPath(version.id, item.slug)}"><span class="lesson-number">${String(index + 1).padStart(2, "0")}</span><span>${escape(item.title)}</span></a>`).join("")}</nav></details></aside>`;
    const body = `<div class="lesson-layout">${sidebar}<article><p class="eyebrow">Lesson ${i + 1} of ${lessons.length} · ${escape(version.label)}</p><h1>${escape(lesson.title)}</h1><p class="lead">${escape(lesson.goal)}</p>${version.channel === "development" ? '<p class="version-note">Development course: behavior may change with future runtime updates.</p>' : ""}${lesson.versionNote ? `<p class="version-note">${escape(lesson.versionNote)}</p>` : ""}<div class="lesson-workspace"><div class="lesson-explanation">
<section aria-labelledby="learn"><h2 id="learn">Learn</h2>${lesson.paragraphs.map((text) => `<p>${escape(text)}</p>`).join("")}<details><summary>Example output</summary><pre class="expected-output">${escape(lesson.output)}</pre></details></section>
<section aria-labelledby="practice"><h2 id="practice">Experiment</h2><p>${escape(lesson.task)}</p><details class="practice-answer"><summary>Check your understanding</summary><p>${escape(lesson.answer)}</p></details><details class="practice-tip"><summary>A useful tip</summary><p>${escape(lesson.pitfall)}</p></details></section>
<section aria-labelledby="references"><h2 id="references">Explore the official manual</h2><ul>${lesson.refs.map((ref) => `<li><a href="${source(ref, version)}">Official ${escape(version.label)} documentation: ${escape(ref)}</a></li>`).join("")}${slug === "blocks" ? '<li><a href="https://docs.ruby-lang.org/en/3.4/NEWS_md.html">Ruby 3.4 release notes: introduction of the it block parameter</a></li>' : ""}</ul></section></div>
<div class="lesson-editor"><div id="tutorial-runner" data-lesson="${slug}" data-version="${version.id}"><pre><code>${escape(lesson.code)}</code></pre><a class="button" href="${escape(share)}" target="_blank" rel="noopener noreferrer">Continue in full Playground ↗</a><p class="note">Enable JavaScript to edit and run code here, or use the full playground.</p></div></div></div>
<div class="lesson-completion"><button class="button" data-complete-lesson hidden>Mark complete</button><span class="note">Progress is saved in this browser.</span></div><nav class="lesson-navigation" aria-label="Lesson navigation">${i ? `<div><span>Previous</span>${link(lessons[i - 1], version)}</div>` : `<div><a href="${coursePath(version)}">All lessons</a></div>`}<div><span>${i + 1 < lessons.length ? "Next lesson" : "Keep exploring"}</span>${i + 1 < lessons.length ? link(lessons[i + 1], version) : `<a href="${coursePath(version)}">Back to your learning path</a>`}</div></nav></article></div>`;
    write(
      `tutorial/${version.id}/${slug}/index.html`,
      page(
        url,
        `${lesson.title} | ${version.label} Tutorial`,
        lesson.goal,
        body,
      ),
    );
    sitemap.push(url);
  }
  const body = `<div class="course-home"><p class="eyebrow">${escape(versionLabel(version))} · Learn in your browser</p><h1>Ruby Tutorial</h1><p class="lead">Learn Ruby, one experiment at a time.</p><p>Write your first program, change it, and see what happens. Follow the lessons at your own pace — no installation needed.</p>${lessons.length ? `<a class="button" data-resume-course href="${lessonPath(version.id, lessons[0].slug)}">Start learning Ruby</a>` : ""}<div class="course-progress"><p data-progress-summary>0 of ${lessons.length} completed</p><progress data-progress-bar max="${lessons.length}" value="0" aria-label="Course progress"></progress></div><h2>Your learning path</h2><nav aria-label="Course contents">${chapters
    .map(
      (chapter) =>
        `<section class="course-chapter"><h3>${escape(chapter)}</h3><div class="lesson-cards">${lessons
          .filter((lesson) => lesson.chapter === chapter)
          .map(
            (lesson) =>
              `<a class="lesson-card" data-lesson-link="${lesson.slug}" href="${lessonPath(version.id, lesson.slug)}"><span class="lesson-number">${String(lessons.indexOf(lesson) + 1).padStart(2, "0")}</span><div><strong>${escape(lesson.title)}</strong><p>${escape(lesson.goal)}</p></div><span aria-hidden="true">→</span></a>`,
          )
          .join("")}</div></section>`,
    )
    .join("")}</nav></div>`;
  const html = page(
    coursePath(version),
    `${version.label} Tutorial – Learn Ruby in Your Browser`,
    `Learn ${version.label} step by step with interactive lessons, practice tasks and version-specific explanations.`,
    body,
  );
  write(`tutorial/${version.id}/index.html`, html);
  if (version.id === latestTutorialVersion) write("tutorial/index.html", html);
  sitemap.push(coursePath(version));
}
redirect("tutorial/latest/index.html", coursePath(latest));
for (const slug of tutorialSlugs) {
  redirect(
    `tutorial/${slug}/index.html`,
    lessonPath(latestTutorialVersion, slug),
  );
  redirect(
    `tutorial/latest/${slug}/index.html`,
    lessonPath(latestTutorialVersion, slug),
  );
}
redirect("examples/index.html", "/tutorial/");
write(
  "assets/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((url) => `  <url><loc>https://ruby-play.dev${url}</loc></url>`).join("\n")}\n</urlset>\n`,
);
