import { isRubyVersion, type RubyVersion } from "../versions";
import {
  latestTutorialVersion,
  tutorialSlugs,
  tutorialVersions,
} from "./content";
import redirects from "./data/redirects.json";

export type TutorialRoute =
  | { kind: "page"; path: string; version: RubyVersion; slug?: string }
  | { kind: "redirect"; path: string; destination: string }
  | { kind: "not-found" };

export function resolveTutorialRoute(pathname: string): TutorialRoute {
  const path = `${pathname.replace(/\/+$/, "")}/`;
  if (path === "/examples/")
    return { kind: "redirect", path, destination: "/tutorial/" };
  if (path === "/tutorial/")
    return { kind: "page", path, version: latestTutorialVersion };
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "tutorial" || parts.length > 3) return { kind: "not-found" };
  const [, versionOrSlug, slug] = parts;
  if (versionOrSlug === "latest") {
    if (slug && !isKnownSlug(slug)) return { kind: "not-found" };
    return {
      kind: "redirect",
      path,
      destination: destination(latestTutorialVersion, slug),
    };
  }
  if (isRubyVersion(versionOrSlug)) {
    if (slug && !isKnownSlug(slug)) return { kind: "not-found" };
    const retired = redirects.find((item) => item.slug === slug);
    return retired
      ? {
          kind: "redirect",
          path,
          destination: destination(versionOrSlug, retired.redirectTo),
        }
      : {
          kind: "page",
          path,
          version: versionOrSlug,
          ...(slug ? { slug } : {}),
        };
  }
  if (parts.length === 2 && isKnownSlug(versionOrSlug))
    return {
      kind: "redirect",
      path,
      destination: destination(latestTutorialVersion, versionOrSlug),
    };
  return { kind: "not-found" };
}

function isKnownSlug(slug: string): boolean {
  return (
    tutorialSlugs.includes(slug) || redirects.some((item) => item.slug === slug)
  );
}
function destination(version: RubyVersion, slug?: string): string {
  const successor =
    redirects.find((item) => item.slug === slug)?.redirectTo ?? slug;
  return `/tutorial/${version}/${successor ? `${successor}/` : ""}`;
}

export function tutorialRoutes(): Exclude<
  TutorialRoute,
  { kind: "not-found" }
>[] {
  const slugs = [...tutorialSlugs, ...redirects.map((item) => item.slug)];
  const paths = [
    "/tutorial/",
    "/examples/",
    ...slugs.map((slug) => `/tutorial/${slug}/`),
    ...["latest", ...tutorialVersions.map((version) => version.id)].flatMap(
      (version) => [
        `/tutorial/${version}/`,
        ...slugs.map((slug) => `/tutorial/${version}/${slug}/`),
      ],
    ),
  ];
  return paths.flatMap((path) => {
    const route = resolveTutorialRoute(path);
    return route.kind === "not-found" ? [] : [route];
  });
}
