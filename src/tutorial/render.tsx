import { renderToString } from "react-dom/server";
import TutorialApp from "./app";
import { validateTutorialData } from "./validation";
import { resolveLesson } from "./content";
import type { TutorialRoute } from "./routes";

validateTutorialData();

const origin = "https://ruby-play.dev";
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function renderTutorialDocument(
  shell: string,
  route: Exclude<TutorialRoute, { kind: "not-found" }>,
): string {
  if (route.kind === "redirect") {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ruby Tutorial</title><meta name="robots" content="noindex"><link rel="canonical" href="${origin}${escape(route.destination)}"><meta http-equiv="refresh" content="0;url=${escape(route.destination)}"></head><body><p>Continue to <a href="${escape(route.destination)}">Ruby Tutorial</a>.</p></body></html>`;
  }
  const lesson = route.slug
    ? resolveLesson(route.slug, route.version)
    : undefined;
  const unavailable = Boolean(route.slug && !lesson);
  const title = lesson
    ? `${lesson.title} — Ruby ${route.version} Tutorial`
    : `Ruby ${route.version} Tutorial — Ruby Playground`;
  const description =
    lesson?.goal ??
    `Learn Ruby ${route.version} step by step with runnable examples, practice tasks, and explanations.`;
  const canonical = `${origin}/tutorial/${route.version}/${route.slug ? `${route.slug}/` : ""}`;
  const image = unavailable
    ? `${origin}/tutorial/${route.version}/og.png`
    : `${canonical}og.png`;
  const metadata = `<title>${escape(title)}</title>\n<meta name="description" content="${escape(description)}">\n<link rel="canonical" href="${escape(canonical)}">\n<meta property="og:title" content="${escape(title)}">\n<meta property="og:description" content="${escape(description)}">\n<meta property="og:url" content="${escape(canonical)}">\n<meta property="og:image" content="${escape(image)}">\n<meta property="og:image:type" content="image/png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="${escape(title)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${escape(image)}">\n<meta name="twitter:image:alt" content="${escape(title)}">\n<meta name="twitter:title" content="${escape(title)}">\n<meta name="twitter:description" content="${escape(description)}">\n${unavailable ? '<meta name="robots" content="noindex">' : ""}\n<link rel="stylesheet" href="/tutorial.css">`;
  const markup = renderToString(
    <TutorialApp version={route.version} slug={route.slug} />,
  );
  return shell
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(
      /<meta\s+(?:name="(?:description|twitter:title|twitter:description|twitter:card|twitter:image(?::alt)?)"|property="og:(?:title|description|url|image(?::[a-z]+)?)")[^>]*>/gi,
      "",
    )
    .replace(/<link\s+rel="canonical"[^>]*>/gi, "")
    .replace("</head>", () => `${metadata}\n</head>`)
    .replace(
      /<div id="root">[\s\S]*?<\/div>/,
      () => `<div id="root" data-prerendered>${markup}</div>`,
    )
    .replace('href="./favicon.svg"', 'href="/favicon.svg"')
    .replaceAll('src="./src/', 'src="/src/');
}
