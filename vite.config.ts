// Adapted from glassmonkey/php-playground (Apache-2.0).
// Modified for Ruby setup: no automatic browser launch; explicit fixed port.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tutorialPlugin } from "./src/build/tutorial-plugin";

export default defineConfig({
  plugins: [react(), tutorialPlugin()],
  // Worker-only dependencies must be ready before the first manual tutorial run.
  optimizeDeps: { include: ["@ruby/wasm-wasi", "@bjorn3/browser_wasi_shim"] },
  server: { host: "127.0.0.1", port: 18888, strictPort: true },
  publicDir: "assets",
  build: { outDir: "public", assetsDir: "." },
});
