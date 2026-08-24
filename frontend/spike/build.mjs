// Build for the throwaway spike pages. Kept out of frontend/build.mjs on
// purpose: nothing in here ships with the app, and frontend/src/ is headed for
// TypeScript (#23) while this directory is not.
//
// Usage (from the repo root):
//   node frontend/spike/build.mjs
//   ruby -run -e httpd public -p 8129     # or the Rails server
//   open http://localhost:8129/ruby-wasm/spike/capability-probe.html
//
// Output lands in public/ruby-wasm/spike/, which is gitignored, and relies on
// frontend's own `npm run build` having already put ruby.wasm next to it.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, "..", "..", "public", "ruby-wasm", "spike");

mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
    "capability-probe": join(here, "capability-probe.js"),
    "capability-probe.worker": join(here, "capability-probe.worker.js"),
  },
  bundle: true,
  format: "esm",
  outdir,
  sourcemap: true,
});

cpSync(join(here, "capability-probe.html"), join(outdir, "capability-probe.html"));

// The app ships the stdlib-less ruby.wasm (frontend/build.mjs). The same npm
// package also ships a stdlib-bearing build, and the survey needs to compare
// the two, so put it where the probe page can fetch it. Renamed without the
// plus sign so it needs no escaping in the ?wasm= query parameter.
cpSync(
  join(here, "..", "node_modules", "@ruby", "4.0-wasm-wasi", "dist", "ruby+stdlib.wasm"),
  join(outdir, "ruby-stdlib.wasm"),
);

console.log(`Spike build complete: ${outdir}`);
