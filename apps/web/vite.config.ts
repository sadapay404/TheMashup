import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  envDir: "..", // repo-root .env provides VITE_* vars
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // bind 0.0.0.0 — required by the sandbox live preview
    port: 8080,
    strictPort: true,
    allowedHosts: true, // accept the sandbox preview hostname
    cors: false, // let the gateway own CORS (desktop Tauri preflights included)
    proxy: {
      // Browser uses relative /api URLs; Vite forwards to the Express gateway.
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: false },
    },
  },
  preview: {
    host: true,
    port: 8080,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
