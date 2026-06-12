// ===== 终端主题镜像（conmux::theme，serde snake_case）=====

export type ThemeAppearance = "dark" | "light";

export interface TerminalTheme {
  id: string;
  name: string;
  appearance: ThemeAppearance;
  background: string;
  foreground: string;
  cursor: string;
  selection_background: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  bright_black: string;
  bright_red: string;
  bright_green: string;
  bright_yellow: string;
  bright_blue: string;
  bright_magenta: string;
  bright_cyan: string;
  bright_white: string;
}
