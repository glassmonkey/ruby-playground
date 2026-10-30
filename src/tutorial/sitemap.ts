import { tutorialRoutes } from "./routes";
import { resolveLesson } from "./content";

/** Canonical, indexable URLs only; aliases and unavailable lessons are omitted. */
export function renderSitemap(): string {
  const urls = [
    "https://ruby-play.dev/",
    ...tutorialRoutes().flatMap((route) =>
      route.kind === "page" &&
      route.path !== "/tutorial/" &&
      (!route.slug || resolveLesson(route.slug, route.version))
        ? [`https://ruby-play.dev${route.path}`]
        : [],
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}\n</urlset>\n`;
}
