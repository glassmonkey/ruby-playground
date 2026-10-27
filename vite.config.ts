// Adapted from glassmonkey/php-playground (Apache-2.0).
// Modified for Ruby setup: no automatic browser launch; explicit fixed port.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 18888, strictPort: true },
  publicDir: "assets",
  build: { outDir: "public", assetsDir: "." },
});
