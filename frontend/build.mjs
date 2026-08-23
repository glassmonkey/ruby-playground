import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: {
    "ruby-playground": "src/index.js",
    "worker": "src/worker.js",
    "completion-worker.spike": "src/completion-worker.spike.js",
  },
  bundle: true,
  format: "esm",
  outdir: "dist",
  sourcemap: true,
});

cpSync("node_modules/@ruby/4.0-wasm-wasi/dist/ruby.wasm", "dist/ruby.wasm");

// ADR-0014: local (and CI) dev serves the bundle straight from Rails'
// public/, which is gitignored and expected to be populated by this build.
cpSync("dist", "../public/ruby-wasm", { recursive: true });

console.log("Build complete: dist/ + public/ruby-wasm/ (ruby-playground.js, worker.js, ruby.wasm)");
