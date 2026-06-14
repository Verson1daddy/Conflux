// ===== 终端主题（D7 预置，conmux 属主，conflux 消费）=====
// 预置数据来自 conmux::builtin_terminal_themes（list_terminal_themes 命令）；
// 选中态是前端展示偏好（localStorage），与 island mode 同策略。
// 切换实时生效：经 xterm-registry 广播到所有已挂载终端（无需重挂载）。

import type { TerminalTheme } from "./theme-types";
import { listTerminalThemes } from "./ipc";

const STORAGE_KEY = "conflux.terminalThemeId";
export const DEFAULT_TERMINAL_THEME_ID = "b-dark-ink";

/** 内置兜底（=conmux 默认蓝墨①），后端不可用（demo/测试）时仍有完整主题。 */
const FALLBACK_THEME: TerminalTheme = {
  id: DEFAULT_TERMINAL_THEME_ID,
  name: "暗 · 蓝墨",
  appearance: "dark",
  background: "#1E2030",
  foreground: "#CAD3F5",
  cursor: "#F4DBD6",
  selection_background: "#363A4F",
  black: "#363A4F",
  red: "#ED8796",
  green: "#A6DA95",
  yellow: "#EED49F",
  blue: "#8AADF4",
  magenta: "#C6A0F6",
  cyan: "#8BD5CA",
  white: "#B8C0E0",
  bright_black: "#494D64",
  bright_red: "#F0949F",
  bright_green: "#B0E0A0",
  bright_yellow: "#F2DBAA",
  bright_blue: "#97B5F6",
  bright_magenta: "#CFADF8",
  bright_cyan: "#98DBD2",
  bright_white: "#CAD3F5",
};

let themes: TerminalTheme[] = [FALLBACK_THEME];
let currentId: string = readPersistedThemeId();
const listeners = new Set<() => void>();

function readPersistedThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_TERMINAL_THEME_ID;
  } catch {
    return DEFAULT_TERMINAL_THEME_ID;
  }
}

/** 启动时调用一次：从 conmux 拉预置列表（失败保持兜底单预置）。 */
export async function initTerminalThemes(): Promise<void> {
  try {
    const list = await listTerminalThemes();
    if (list.length > 0) {
      themes = list;
      notify();
    }
  } catch {
    /* 后端不可用——兜底蓝墨 */
  }
}

export function getTerminalThemes(): TerminalTheme[] {
  return themes;
}

export function getCurrentTerminalTheme(): TerminalTheme {
  return themes.find((t) => t.id === currentId) ?? themes[0] ?? FALLBACK_THEME;
}

export function getCurrentTerminalThemeId(): string {
  return getCurrentTerminalTheme().id;
}

export function setTerminalTheme(id: string): void {
  if (!themes.some((t) => t.id === id)) return;
  currentId = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* 私密模式等 */
  }
  notify();
}

export function subscribeTerminalTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of listeners) cb();
}

/** TerminalTheme → xterm ITheme（snake_case → xterm 键名）。 */
export function toXtermTheme(t: TerminalTheme): Record<string, string> {
  return {
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.background,
    selectionBackground: t.selection_background,
    selectionForeground: t.bright_white,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.bright_black,
    brightRed: t.bright_red,
    brightGreen: t.bright_green,
    brightYellow: t.bright_yellow,
    brightBlue: t.bright_blue,
    brightMagenta: t.bright_magenta,
    brightCyan: t.bright_cyan,
    brightWhite: t.bright_white,
  };
}
