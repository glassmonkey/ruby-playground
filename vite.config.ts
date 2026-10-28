// Adapted from glassmonkey/php-playground (Apache-2.0).
// Modified for Ruby setup: no automatic browser launch; explicit fixed port.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import lessons from "./content/tutorial.json";
import supplements from "./content/tutorial-supplements.json";
import catalog from "./content/tutorial-versions.json";

export default defineConfig({
  plugins: [react()],
  // Worker-only dependencies must be ready before the first manual tutorial run.
  optimizeDeps: { include: ["@ruby/wasm-wasi", "@bjorn3/browser_wasi_shim"] },
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
          ["latest", ...catalog.versions.map((version) => version.id)]
            .flatMap((version) => [
              [
                `tutorial-${version}`,
                new URL(`./tutorial/${version}/index.html`, import.meta.url)
                  .pathname,
              ],
              ...[...lessons, ...supplements].map((lesson) => [
                `tutorial-${version}-${lesson.slug}`,
                new URL(
                  `./tutorial/${version}/${lesson.slug}/index.html`,
                  import.meta.url,
                ).pathname,
              ]),
            ])
            .concat(
              [...lessons, ...supplements].map((lesson) => [
                `tutorial-alias-${lesson.slug}`,
                new URL(`./tutorial/${lesson.slug}/index.html`, import.meta.url)
                  .pathname,
              ]),
            ),
        ),
      },
    },
  },
});
