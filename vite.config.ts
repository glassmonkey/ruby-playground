// Adapted from glassmonkey/php-playground (Apache-2.0).
// Modified for Ruby setup: no automatic browser launch; explicit fixed port.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import lessons from "./content/tutorial.json";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 18888, strictPort: true },
  publicDir: "assets",
  build: {
    outDir: "public",
    assetsDir: ".",
    rollupOptions: {
      input: {
        index: new URL("./index.html", import.meta.url).pathname,
        examples: new URL("./examples/index.html", import.meta.url).pathname,
        tutorial: new URL("./tutorial/index.html", import.meta.url).pathname,
        ...Object.fromEntries(
          lessons.map((lesson) => [
            `tutorial-${lesson.slug}`,
            new URL(`./tutorial/${lesson.slug}/index.html`, import.meta.url)
              .pathname,
          ]),
        ),
      },
    },
  },
});
