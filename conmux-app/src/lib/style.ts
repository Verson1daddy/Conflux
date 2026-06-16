// ===== conmux 风格 store（M③：chrome 语义 token + 配对终端预置）=====
//
// 风格数据属主 = conmux 机制层（crates/conmux/src/theme.rs::builtin_styles）。
// 经 Tauri 命令 `list_styles`（commands.rs 直读 conmux::builtin_styles）拉取。
//
// 一个 Style = 一组 chrome token（app 壳颜色）+ 一个 terminal_theme_id（指向
// terminal-core 已加载的 TerminalTheme 之一）。换肤 =
//   (1) 换一组 chrome CSS 变量（applyChromeVars）
//   (2) 取 terminal_theme_id 对应 TerminalTheme 喂 xterm（经 terminal-core 的
//       setTerminalTheme/useTerminalTheme 广播链——无需重挂载终端）。
// conflux 不消费 Style（只用 TerminalTheme），故此层是 conmux-app 私有。
//
// 选中态持久化 localStorage（仿 terminal-theme.ts 的展示偏好范式），订阅广播驱动
// React useSyncExternalStore 重渲染 chrome。

import { invoke } from "@tauri-apps/api/core";

export type StyleAppearance = "dark" | "light";

/** chrome 层语义 token（镜像 conmux::ChromeTokens，serde snake_case，14 字段）。 */
export interface ChromeTokens {
  surface_base: string;
  surface_chrome: string;
  surface_raised: string;
  line_hairline: string;
  line_soft: string;
  text_primary: string;
  text_content: string;
  text_muted: string;
  text_faint: string;
  accent_signal: string;
  status_running: string;
  status_warn: string;
  status_idle: string;
  status_attention: string;
}

/** 完整风格（镜像 conmux::Style，serde snake_case）。 */
export interface Style {
  id: string;
  name: string;
  appearance: StyleAppearance;
  /** 配对终端预置 id（指向 terminal-core 已加载的 TerminalTheme 之一）。 */
  terminal_theme_id: string;
  chrome: ChromeTokens;
}

const STORAGE_KEY = "conmux.styleId";
/** 默认风格（=conmux DEFAULT_STYLE_ID，B · Paper Terminal）。 */
export const DEFAULT_STYLE_ID = "b-paper";

/** 内置兜底（=B · Paper Terminal 完整值，F1 §2 B 列）。后端不可用时仍有完整 chrome。 */
const FALLBACK_STYLE: Style = {
  id: DEFAULT_STYLE_ID,
  name: "纸感终端",
  appearance: "light",
  terminal_theme_id: "b-paper-term",
  chrome: {
    surface_base: "#F6F1E7",
    surface_chrome: "#EDE5D4",
    surface_raised: "#FBF7EE",
    line_hairline: "#DDD3C0",
    line_soft: "#E6DECD",
    text_primary: "#23201A",
    text_content: "#2B2720",
    text_muted: "#8A8170",
    text_faint: "#A89E8A",
    accent_signal: "#B5503C",
    status_running: "#6E7B52",
    status_warn: "#C08A2E",
    status_idle: "#B9AE98",
    status_attention: "#B5503C",
  },
};

let styles: Style[] = [FALLBACK_STYLE];
let currentId: string = readPersistedStyleId();
const listeners = new Set<() => void>();

function readPersistedStyleId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_STYLE_ID;
  } catch {
    return DEFAULT_STYLE_ID;
  }
}

/** 启动时调用一次：从 conmux 拉风格列表（失败保持兜底单风格）。 */
export async function initStyles(): Promise<void> {
  try {
    const list = await invoke<Style[]>("list_styles");
    if (list.length > 0) {
      styles = list;
      notify();
    }
  } catch {
    /* 后端不可用——兜底纸感风格 */
  }
}

export function getStyles(): Style[] {
  return styles;
}

export function getCurrentStyle(): Style {
  return styles.find((s) => s.id === currentId) ?? styles[0] ?? FALLBACK_STYLE;
}

export function getCurrentStyleId(): string {
  return getCurrentStyle().id;
}

export function setStyle(id: string): void {
  if (!styles.some((s) => s.id === id)) return;
  currentId = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* 私密模式等 */
  }
  notify();
}

/** 循环切到下一风格（A→B→C→A，状态栏切换钮用）。 */
export function cycleStyle(): void {
  if (styles.length === 0) return;
  const idx = styles.findIndex((s) => s.id === currentId);
  const next = styles[(idx + 1) % styles.length];
  setStyle(next.id);
}

export function subscribeStyle(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of listeners) cb();
}

/** chrome token → CSS 变量名映射（一处定义，组件与 applyChromeVars 共用）。 */
export const CHROME_CSS_VARS: Record<keyof ChromeTokens, string> = {
  surface_base: "--cx-surface-base",
  surface_chrome: "--cx-surface-chrome",
  surface_raised: "--cx-surface-raised",
  line_hairline: "--cx-line-hairline",
  line_soft: "--cx-line-soft",
  text_primary: "--cx-text-primary",
  text_content: "--cx-text-content",
  text_muted: "--cx-text-muted",
  text_faint: "--cx-text-faint",
  accent_signal: "--cx-accent-signal",
  status_running: "--cx-status-running",
  status_warn: "--cx-status-warn",
  status_idle: "--cx-status-idle",
  status_attention: "--cx-status-attention",
};

/**
 * 把一组 chrome token 写到 :root 的 CSS 变量上（换肤的 chrome 半）。
 * 终端半（喂 xterm）由调用方经 terminal-core 的 setTerminalTheme 处理。
 */
export function applyChromeVars(style: Style): void {
  const root = document.documentElement;
  const chrome = style.chrome;
  (Object.keys(CHROME_CSS_VARS) as (keyof ChromeTokens)[]).forEach((key) => {
    root.style.setProperty(CHROME_CSS_VARS[key], chrome[key]);
  });
  // appearance 作 data 属性，便于按明暗微调（如脉冲动画强度）。
  root.dataset.cxAppearance = style.appearance;
}
