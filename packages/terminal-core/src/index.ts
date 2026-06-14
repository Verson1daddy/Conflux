// @conmux/terminal-core — 共享终端渲染/主题/IPC 切片（conflux-app + conmux-app 双消费）。
// 迁移进度：Task 3 纯叶子（主题类型/注册表/输入/滚轮/退出守卫）。
// 待迁：ipc + terminal-theme + useTerminalTheme（Task 4）、session store + XtermTerminal（Task 5）。

export * from "./theme-types";
export * from "./xterm-registry";
export * from "./terminal-input";
export * from "./terminal-wheel";
export * from "./exit-guard";
