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
        overlay: resolve(__dirname, "renderer/overlay.html"),
        login: resolve(__dirname, "renderer/login.html"),
        app: resolve(__dirname, "renderer/app.html"),
        menu: resolve(__dirname, "renderer/menu.html"),
        update: resolve(__dirname, "renderer/update.html"),
      },
    },
  },
  server: { port: 5174 },
});
