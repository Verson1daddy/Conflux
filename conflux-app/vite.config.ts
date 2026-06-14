import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 共享终端切片包（源码消费，先于 "@" 匹配避免前缀冲突）。
      "@conmux/terminal-core": path.resolve(__dirname, "../packages/terminal-core/src"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  optimizeDeps: {
    entries: ["index.html"],
  },
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
          "xterm": ["@xterm/xterm", "@xterm/addon-fit"],
          "xterm-webgl": ["@xterm/addon-webgl"],
          // Markdown + syntax highlight 只在讨论/产物抽屉里使用，避免压到主入口。
          "markdown-vendor": [
            "react-markdown",
            "remark-gfm",
          ],
          "syntax-vendor": [
            "react-syntax-highlighter",
          ],
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
