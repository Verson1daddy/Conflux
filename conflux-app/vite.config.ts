import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          // xterm.js 是最大的单独依赖 (~300KB)，独立分包
          // 附带的 addon（fit/webgl）也要一起放进 xterm chunk，否则 webgl
          // 会意外进入主 chunk 把 index.js 膨胀 100KB+。
          "xterm": ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-webgl"],
          // React 运行时单独分包（缓存命中率高，更新频率低）
          "react-vendor": ["react", "react-dom"],
          // Tauri API 单独分包
          "tauri": ["@tauri-apps/api", "@tauri-apps/plugin-shell"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
