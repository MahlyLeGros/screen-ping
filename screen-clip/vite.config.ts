import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  root: "renderer",
  base: "./",
  build: {
    outDir: "../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, "renderer/app.html"),
        menu: resolve(__dirname, "renderer/menu.html"),
      },
    },
  },
  server: { port: 5175 },
});
