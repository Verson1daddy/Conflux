// ===== conmux-app vitest 配置（M⑤h 质量加固）=====
//
// 只测纯函数（parseCommand / RECENT 纯核心 / extractSubagents / ansi / osc7 /
// session-status 派生）——environment=node（无需 jsdom，不引 React 组件测，降复杂度，
// 组件路径由 e2e 覆盖）。alias 与 vite.config 对齐（session-status 经类型引 terminal-core）。
//
// 不破：独立 vitest.config，不挂进 vite.config；`npm -w conmux-app test` 与 conflux-app
// 的 251 互不影响（各自 workspace 各自 config）。

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@conmux/terminal-core": path.resolve(
        __dirname,
        "../packages/terminal-core/src"
      ),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
