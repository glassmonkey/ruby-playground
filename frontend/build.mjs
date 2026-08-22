import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: {
    "ruby-playground": "src/index.js",
    "worker": "src/worker.js",
  },
  bundle: true,
  format: "esm",
  outdir: "dist",
  sourcemap: true,
});

copyFileSync("node_modules/@ruby/4.0-wasm-wasi/dist/ruby.wasm", "dist/ruby.wasm");

console.log("Build complete: dist/ruby-playground.js + dist/worker.js + dist/ruby.wasm");
