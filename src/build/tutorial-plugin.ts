import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tutorialThemeCss } from "../design-tokens";

async function tutorialStyles(root: string): Promise<string> {
  const files = ["src/fonts.css", "src/brand.css", "src/tutorial/styles.css"];
  return (
    tutorialThemeCss +
    (
      await Promise.all(
        files.map((file) => readFile(path.join(root, file), "utf8")),
      )
    ).join("\n")
  );
}
import { createServer, type Plugin, type ResolvedConfig } from "vite";
import { resolveTutorialRoute, tutorialRoutes } from "../tutorial/routes";
import { renderSitemap } from "../tutorial/sitemap";
import { resolveLesson } from "../tutorial/content";
import type { renderSocialImage } from "../tutorial/social-image";
import type { renderTutorialDocument } from "../tutorial/render";

type ImageRenderer = { renderSocialImage: typeof renderSocialImage };

type Renderer = { renderTutorialDocument: typeof renderTutorialDocument };

export function tutorialPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "tutorial-pages",
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        try {
          if (pathname === "/sitemap.xml") {
            res.setHeader("Content-Type", "application/xml; charset=utf-8");
            res.end(renderSitemap());
            return;
          }
          if (
            pathname.startsWith("/tutorial/") &&
            pathname.endsWith("/og.png")
          ) {
            const route = resolveTutorialRoute(pathname.slice(0, -6));
            const lesson =
              route.kind === "page" && route.slug
                ? resolveLesson(route.slug, route.version)
                : undefined;
            if (route.kind !== "page" || (route.slug && !lesson)) {
              res.statusCode = 404;
              res.end("Tutorial image not found");
              return;
            }
            const renderer = (await server.ssrLoadModule(
              "/src/tutorial/social-image.tsx",
            )) as ImageRenderer;
            res.setHeader("Content-Type", "image/png");
            res.setHeader("Cache-Control", "no-cache");
            res.end(
              renderer.renderSocialImage(
                route.version,
                lesson,
                path.join(config.root, "assets/fonts/plus-jakarta-sans.ttf"),
              ),
            );
            return;
          }
          if (pathname === "/tutorial.css") {
            res.setHeader("Content-Type", "text/css");
            res.end(await tutorialStyles(server.config.root));
            return;
          }
          const route = resolveTutorialRoute(pathname);
          if (route.kind === "not-found") {
            if (/^\/(tutorial|examples)(\/|$)/.test(pathname)) {
              res.statusCode = 404;
              res.end("Tutorial page not found");
              return;
            }
            next();
            return;
          }
          if (route.kind === "redirect") {
            const url = new URL(req.url ?? "/", "http://localhost");
            res.writeHead(302, {
              Location: `${route.destination}${url.search}`,
            });
            res.end();
            return;
          }
          const renderer = (await server.ssrLoadModule(
            "/src/tutorial/render.tsx",
          )) as Renderer;
          const shell = await readFile(
            path.join(server.config.root, "index.html"),
            "utf8",
          );
          const html = await server.transformIndexHtml(
            pathname,
            renderer.renderTutorialDocument(shell, route),
          );
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
    async closeBundle() {
      if (config.command !== "build" || config.build.ssr) return;
      const output = path.resolve(config.root, config.build.outDir);
      const shell = await readFile(path.join(output, "index.html"), "utf8");
      // Load the same TSX module used by development without adding another browser entry.
      const rendererServer = await createServer({
        configFile: false,
        root: config.root,
        appType: "custom",
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
        esbuild: { jsx: "automatic" },
        optimizeDeps: { noDiscovery: true },
      });
      try {
        const renderer = (await rendererServer.ssrLoadModule(
          "/src/tutorial/render.tsx",
        )) as Renderer;
        const imageRenderer = (await rendererServer.ssrLoadModule(
          "/src/tutorial/social-image.tsx",
        )) as ImageRenderer;
        const routes = tutorialRoutes();
        for (const route of routes) {
          const directory = path.join(output, route.path);
          await mkdir(directory, { recursive: true });
          if (route.kind === "page") {
            const lesson = route.slug
              ? resolveLesson(route.slug, route.version)
              : undefined;
            if (!route.slug || lesson) {
              await writeFile(
                path.join(directory, "og.png"),
                imageRenderer.renderSocialImage(
                  route.version,
                  lesson,
                  path.join(config.root, "assets/fonts/plus-jakarta-sans.ttf"),
                ),
              );
            }
          }
          await writeFile(
            path.join(directory, "index.html"),
            renderer.renderTutorialDocument(shell, route),
          );
        }
        await writeFile(
          path.join(output, "tutorial.css"),
          await tutorialStyles(config.root),
        );
        await writeFile(path.join(output, "sitemap.xml"), renderSitemap());
      } finally {
        await rendererServer.close();
      }
    },
  };
}
