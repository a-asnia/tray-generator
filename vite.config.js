import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Сборка в ОДИН самодостаточный HTML: весь JS, CSS и wasm (Manifold)
// инлайнятся в dist/index.html — файл можно класть на сервер как есть.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    // wasm Manifold-а (~1 МБ) встраивается как data-URI
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 100 * 1024,
  },
});
