import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
  },
  plugins: [
    VitePWA({
      // 5分の3分目に勝手にリロードされるのは許されないので prompt。
      // 待機中の更新は閉店中の画面でのみ適用する（src/pwa/register.ts）。
      registerType: "prompt",
      includeAssets: ["icons/*.png", "fonts/*.woff2"],
      manifest: {
        name: "のれん",
        short_name: "のれん",
        description: "1日5分だけ開く英語学習アプリ",
        lang: "ja",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#FFFFFF",
        theme_color: "#FFFFFF",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,json}"],
        // 例文JSONはオフラインでも確実に引けるようプリキャッシュ対象に含める
        navigateFallback: "/index.html",
      },
    }),
  ],
});
