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
    // 5174 避开 conflux-app 的 5173（两者可同时跑 dev）。
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ["@xterm/xterm", "@xterm/addon-fit"],
          "xterm-webgl": ["@xterm/addon-webgl"],
          "react-vendor": ["react", "react-dom"],
        },
      },
    },
  },
});
