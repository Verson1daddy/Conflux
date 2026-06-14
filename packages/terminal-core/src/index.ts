// @conmux/terminal-core — 共享终端渲染/主题/IPC 切片（conflux-app + conmux-app 双消费）。
// 迁移进度：Task 3 纯叶子 + Task 4 主题/IPC。
// 待迁：session store + XtermTerminal（Task 5）。

export * from "./theme-types";
export * from "./pty-types";
export * from "./xterm-registry";
export * from "./terminal-input";
export * from "./terminal-wheel";
export * from "./exit-guard";
export * from "./ipc";
export * from "./terminal-theme";
export { useTerminalTheme } from "./useTerminalTheme";
export { XtermTerminal } from "./XtermTerminal";
export type { XtermTerminalProps } from "./XtermTerminal";
