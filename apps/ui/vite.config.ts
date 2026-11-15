import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web 端仅用于本地开发预览：Steam 接口没有 CORS，通过 vite 代理转发。
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      "/community-proxy": {
        target: "https://steamcommunity.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/community-proxy/, ""),
      },
      "/translate-proxy": {
        target: "https://api.mymemory.translated.net",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/translate-proxy/, ""),
      },
      "/google-translate-proxy": {
        target: "https://translate.googleapis.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/google-translate-proxy/, ""),
      },
      "/steam-proxy": {
        target: "https://store.steampowered.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steam-proxy/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1200,
  },
});
