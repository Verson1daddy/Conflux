// ===== useTerminalTheme =====
// 订阅当前终端主题（React 视图消费：pane 容器底色、Settings 选择器等）。

import { useSyncExternalStore } from "react";
import type { TerminalTheme } from "./theme-types";
import {
  getCurrentTerminalTheme,
  subscribeTerminalTheme,
} from "./terminal-theme";

export function useTerminalTheme(): TerminalTheme {
  return useSyncExternalStore(subscribeTerminalTheme, getCurrentTerminalTheme);
}
