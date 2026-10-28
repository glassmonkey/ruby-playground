import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import lz from "lz-string";
const lessons = JSON.parse(
  readFileSync(new URL("../content/tutorial.json", import.meta.url), "utf8"),
);
const root = new URL("../", import.meta.url);
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const syntax = {
  "Code Layout": "lexical_structure",
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
const source = (name) =>
  `https://docs.ruby-lang.org/en/4.0/${syntax[name] ? `syntax/${syntax[name]}_rdoc` : name}.html`;
const path = (lesson) => `/tutorial/${lesson.slug}/`;
const link = (lesson) =>
  `<a href="${path(lesson)}">${escape(lesson.title)}</a>`;
const style = readFileSync(
  new URL("../content/tutorial.css", import.meta.url),
  "utf8",
);
function page(url, title, description, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} – Ruby Playground</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="https://ruby-play.dev${url}"><link rel="icon" href="/favicon.svg"><style>${style}</style></head><body><header><a href="/">Ruby Playground</a><a href="/tutorial/">Ruby Tutorial</a></header><main>${body}</main><footer><a href="/">Open the playground</a> · <a href="/tutorial/#coverage">Coverage and references</a></footer></body></html>`;
}
function write(relative, text) {
  const url = new URL(relative, root);
  mkdirSync(new URL("./", url), { recursive: true });
  writeFileSync(url, text);
}
for (const [i, lesson] of lessons.entries()) {
  const share = `/?c=${encodeURIComponent(lz.compressToEncodedURIComponent(lesson.code))}&v=4.0`;
  const body = `<p class="eyebrow">${escape(lesson.chapter)} · Lesson ${i + 1} of ${lessons.length}</p><h1>${escape(lesson.title)}</h1><p class="lead">${escape(lesson.goal)}</p><p class="prerequisite">Before you start: ${i ? link(lessons[i - 1]) : "no previous Ruby experience needed"}. Examples use bundled Ruby 4.0.</p>
<section aria-labelledby="learn"><h2 id="learn">Understand the idea</h2>${lesson.paragraphs.map((p) => `<p>${escape(p)}</p>`).join("")}</section>
<section aria-labelledby="run"><h2 id="run">Read, predict, then run</h2><p>Predict what this program will print before opening it in the playground.</p><pre><code>${escape(lesson.code)}</code></pre><a class="button run-example" href="${escape(share)}" target="_blank" rel="noopener noreferrer">Run this lesson in Playground ↗</a><p class="note">Opens a new tab so you can keep this lesson open. Code runs automatically; use puts or p to see a result.</p><h3>Expected output</h3><pre class="expected-output">${escape(lesson.output)}</pre></section>
<section aria-labelledby="practice"><h2 id="practice">Try it yourself</h2><p>${escape(lesson.task)}</p><details><summary>Check your understanding</summary><p>${escape(lesson.answer)}</p></details><h3>Watch out for</h3><p>${escape(lesson.pitfall)}</p></section>
<section aria-labelledby="references"><h2 id="references">Keep learning</h2><p>${escape(lesson.remaining)}</p><ul>${lesson.refs.map((ref) => `<li><a href="${source(ref)}">Official Ruby 4.0 documentation: ${escape(ref)}</a></li>`).join("")}</ul></section>
<nav class="lesson-navigation" aria-label="Lesson navigation">${i ? `<div><span>Previous</span>${link(lessons[i - 1])}</div>` : ""}<div><span>${i + 1 < lessons.length ? "Next lesson" : "You finished the introductory path"}</span>${i + 1 < lessons.length ? link(lessons[i + 1]) : '<a href="/tutorial/#coverage">Choose what to explore next</a>'}</div></nav>`;
  write(
    `tutorial/${lesson.slug}/index.html`,
    page(path(lesson), `${lesson.title} | Ruby Tutorial`, lesson.goal, body),
  );
}
const chapters = [...new Set(lessons.map((l) => l.chapter))];
const coverage = Object.keys(syntax)
  .map(
    (ref) =>
      `<tr><th scope="row"><a href="${source(ref)}">${escape(ref)}</a></th><td>${lessons
        .filter((l) => l.refs.includes(ref))
        .map(link)
        .join(
          "<br>",
        )}</td><td>Introduction available; deeper topics listed in each lesson</td></tr>`,
  )
  .join("");
write(
  "tutorial/index.html",
  page(
    "/tutorial/",
    "Ruby Tutorial – Learn Ruby in Your Browser",
    "Learn Ruby step by step with runnable lessons, practice tasks and explanations. Follow a learning path from output and variables to classes and pattern matching.",
    `<p class="eyebrow">Learn by running Ruby</p><h1>Ruby Tutorial</h1><p class="lead">Learn the language step by step, then change the code and see what happens.</p><p>These ${lessons.length} lessons build from printing your first value to reading advanced syntax. Each includes an explanation, runnable code, expected output and a practice task with feedback. No installation or account is needed.</p><a class="button" href="${path(lessons[0])}">Start learning Ruby</a><p>Already know some Ruby? Pick a lesson below. Keep the lesson open while you experiment in a separate playground tab.</p><nav aria-label="Course contents">${chapters
      .map(
        (ch) =>
          `<section><h2>${escape(ch)}</h2><ol start="${lessons.findIndex((l) => l.chapter === ch) + 1}">${lessons
            .filter((l) => l.chapter === ch)
            .map((l) => `<li>${link(l)}<p>${escape(l.goal)}</p></li>`)
            .join("")}</ol></section>`,
      )
      .join(
        "",
      )}</nav><section id="coverage"><h2>What this tutorial covers</h2><p>The learning order is designed for beginners. The coverage checklist follows the <a href="https://docs.ruby-lang.org/en/4.0/syntax_rdoc.html">official Ruby 4.0 syntax reference</a>. This is an introductory path, not an exhaustive language specification: each lesson identifies the details still to explore.</p><div class="table-scroll"><table><caption>Syntax reference coverage</caption><thead><tr><th>Reference area</th><th>Lesson</th><th>Depth</th></tr></thead><tbody>${coverage}</tbody></table></div><h3>Core APIs and standard libraries</h3><p>Array, Hash, Enumerable and Proc appear where they support a language concept. Their full APIs are outside this first path. Standard libraries, gems, Rails, files, network access and interactive standard input are not taught here. Browser runtime limits make some of these unsuitable for this playground.</p><h3>Versions and verification</h3><p>Runnable examples target the bundled Ruby 4.0 runtime. You can switch versions in the playground to experiment, but the lessons do not promise identical results across every version. Each run starts fresh. Do not enter secrets: shared URLs contain the full source.</p></section>`,
  ),
);
write(
  "assets/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["/", "/tutorial/", ...lessons.map(path)].map((url) => `  <url><loc>https://ruby-play.dev${url}</loc></url>`).join("\n")}\n</urlset>\n`,
);
