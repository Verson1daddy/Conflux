//! 终端主题预置注册表（契约 D7：多预置 + 背景基调可调；base24 精神的槽位）。
//!
//! conmux 是主题数据的唯一属主——conflux 与未来的独立 CLI 形态共享同一套预置
//! （产品定位：conmux 可单用，见 conflux 侧 spec 2026-06-12-cool-craft-direction）。
//! 语义 pastel 前景（红/绿/黄/蓝/紫/青）按明暗两组固定；背景基调按预置切换。
//! agent truecolor 内容透传不经过此层（D8 颜色所有权分层）。
//!
//! 数据源：用户验收样稿 research/mux-theme-samples/b-backgrounds.html（2026-06-10
//! D7 裁决配套），六个预置原样收录。

use serde::{Deserialize, Serialize};

/// 明暗基调（消费端据此做对比度/光标策略）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeAppearance {
    Dark,
    Light,
}

/// 一个终端主题预置（16 ANSI + 基础槽位，hex 字符串 `#RRGGBB`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TerminalTheme {
    pub id: String,
    /// 展示名（含基调说明）
    pub name: String,
    pub appearance: ThemeAppearance,
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection_background: String,
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,
}

/// 默认预置（①蓝墨——2026-06-12 用户实机裁决：与 conflux 冷蓝黑壳同温）。
pub const DEFAULT_TERMINAL_THEME_ID: &str = "b-dark-ink";

/// 暗版语义前景（Catppuccin Macchiato pastel，固定）。
struct DarkSem;
impl DarkSem {
    const RED: &'static str = "#ED8796";
    const GREEN: &'static str = "#A6DA95";
    const YELLOW: &'static str = "#EED49F";
    const BLUE: &'static str = "#8AADF4";
    const MAGENTA: &'static str = "#C6A0F6";
    const CYAN: &'static str = "#8BD5CA";
    const BRIGHT_RED: &'static str = "#F0949F";
    const BRIGHT_GREEN: &'static str = "#B0E0A0";
    const BRIGHT_YELLOW: &'static str = "#F2DBAA";
    const BRIGHT_BLUE: &'static str = "#97B5F6";
    const BRIGHT_MAGENTA: &'static str = "#CFADF8";
    const BRIGHT_CYAN: &'static str = "#98DBD2";
}

/// 亮版语义前景（Catppuccin Latte，深 pastel——亮底才有对比，固定）。
struct LightSem;
impl LightSem {
    const RED: &'static str = "#D20F39";
    const GREEN: &'static str = "#40A02B";
    const YELLOW: &'static str = "#DF8E1D";
    const BLUE: &'static str = "#1E66F5";
    const MAGENTA: &'static str = "#8839EF";
    const CYAN: &'static str = "#179299";
    const BRIGHT_RED: &'static str = "#DE2D52";
    const BRIGHT_GREEN: &'static str = "#49B530";
    const BRIGHT_YELLOW: &'static str = "#EEA02D";
    const BRIGHT_BLUE: &'static str = "#3C7BF6";
    const BRIGHT_MAGENTA: &'static str = "#9A52F2";
    const BRIGHT_CYAN: &'static str = "#1FA8A9";
}

#[allow(clippy::too_many_arguments)]
fn dark(
    id: &str,
    name: &str,
    background: &str,
    foreground: &str,
    selection: &str,
    black: &str,
    white: &str,
    bright_black: &str,
    bright_white: &str,
) -> TerminalTheme {
    TerminalTheme {
        id: id.to_string(),
        name: name.to_string(),
        appearance: ThemeAppearance::Dark,
        background: background.to_string(),
        foreground: foreground.to_string(),
        cursor: "#F4DBD6".to_string(),
        selection_background: selection.to_string(),
        black: black.to_string(),
        red: DarkSem::RED.to_string(),
        green: DarkSem::GREEN.to_string(),
        yellow: DarkSem::YELLOW.to_string(),
        blue: DarkSem::BLUE.to_string(),
        magenta: DarkSem::MAGENTA.to_string(),
        cyan: DarkSem::CYAN.to_string(),
        white: white.to_string(),
        bright_black: bright_black.to_string(),
        bright_red: DarkSem::BRIGHT_RED.to_string(),
        bright_green: DarkSem::BRIGHT_GREEN.to_string(),
        bright_yellow: DarkSem::BRIGHT_YELLOW.to_string(),
        bright_blue: DarkSem::BRIGHT_BLUE.to_string(),
        bright_magenta: DarkSem::BRIGHT_MAGENTA.to_string(),
        bright_cyan: DarkSem::BRIGHT_CYAN.to_string(),
        bright_white: bright_white.to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn light(
    id: &str,
    name: &str,
    background: &str,
    foreground: &str,
    selection: &str,
    black: &str,
    white: &str,
    bright_black: &str,
    bright_white: &str,
) -> TerminalTheme {
    TerminalTheme {
        id: id.to_string(),
        name: name.to_string(),
        appearance: ThemeAppearance::Light,
        background: background.to_string(),
        foreground: foreground.to_string(),
        cursor: "#DC8A78".to_string(),
        selection_background: selection.to_string(),
        black: black.to_string(),
        red: LightSem::RED.to_string(),
        green: LightSem::GREEN.to_string(),
        yellow: LightSem::YELLOW.to_string(),
        blue: LightSem::BLUE.to_string(),
        magenta: LightSem::MAGENTA.to_string(),
        cyan: LightSem::CYAN.to_string(),
        white: white.to_string(),
        bright_black: bright_black.to_string(),
        bright_red: LightSem::BRIGHT_RED.to_string(),
        bright_green: LightSem::BRIGHT_GREEN.to_string(),
        bright_yellow: LightSem::BRIGHT_YELLOW.to_string(),
        bright_blue: LightSem::BRIGHT_BLUE.to_string(),
        bright_magenta: LightSem::BRIGHT_MAGENTA.to_string(),
        bright_cyan: LightSem::BRIGHT_CYAN.to_string(),
        bright_white: bright_white.to_string(),
    }
}

/// 内置六预置（样稿 ①–⑥ 原样）。
pub fn builtin_terminal_themes() -> Vec<TerminalTheme> {
    vec![
        dark("b-dark-ink", "暗 · 蓝墨", "#1E2030", "#CAD3F5", "#363A4F", "#363A4F", "#B8C0E0", "#494D64", "#CAD3F5"),
        dark("b-dark-graphite", "暗 · 中性深灰", "#17191D", "#D2D4DA", "#2C2F36", "#2C3036", "#C4C7CE", "#474C54", "#E2E4E9"),
        dark("b-dark-near-black", "暗 · 近黑", "#0F1012", "#D6D8DC", "#26282D", "#23252A", "#C8CBD1", "#42454C", "#E6E8EB"),
        dark("b-dark-warm-charcoal", "暗 · 暖炭", "#1B1A17", "#D8D4CC", "#322F2A", "#322E28", "#C9C4BB", "#4D4840", "#E8E4DC"),
        light("b-light-paper", "亮 · 暖纸白", "#FAF6F0", "#4C4F69", "#E9E3D9", "#5C5F77", "#BCC0CC", "#6C6F85", "#DCE0E8"),
        light("b-light-cool-white", "亮 · 中性冷白", "#F6F7F9", "#494C5E", "#E4E7EB", "#5A5D72", "#BABEC8", "#6A6D80", "#DADDE4"),
    ]
}

// ===== M③ Style 注册表：ChromeTokens + Style + builtin_styles() =====
//
// 架构决策（M③ F1 契约 §0）：`Style = ChromeTokens + 配对 TerminalTheme`（复合）。
// - `TerminalTheme` 结构**零改动**（conflux 9 文件双链不破，MF-2 满足）。
// - conmux 新增 chrome 语义 token（app 壳：缩点条 / 状态栏 / 窗框）+ Style 复合体。
// - `Style.terminal_theme_id` 指向**现有 6 预置之一**（用户已验收样稿配色）——M③
//   不臆造新终端 ANSI；bespoke A/C 终端配色列为后续 pass。
// - conmux-app 消费整个 Style：chrome → CSS 变量；terminal_theme_id → 取对应
//   TerminalTheme 喂 xterm（复用 terminal-core 的 setTerminalTheme/useTerminalTheme 链）。
//   conflux 只用 TerminalTheme（不知道 Style 存在），故不受影响。

/// chrome 层语义 token（app 壳颜色，hex 字符串 `#RRGGBB`，M③ F1 契约 §1 共 14 字段）。
/// 终端的 cursor/selection 归 `TerminalTheme`，不入此处。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ChromeTokens {
    /// 窗口/pane 底
    pub surface_base: String,
    /// tab 条 / 缩点条 / 状态栏
    pub surface_chrome: String,
    /// peek / popover / hover pill
    pub surface_raised: String,
    /// 1px 边框（发丝线）
    pub line_hairline: String,
    /// 次级分隔
    pub line_soft: String,
    /// 主文字 / 活跃标签 / 标题
    pub text_primary: String,
    /// 终端正文层文字（chrome 内的内容文字）
    pub text_content: String,
    /// 非活跃标签
    pub text_muted: String,
    /// 元信息读数
    pub text_faint: String,
    /// 活跃 / 聚焦 / 跨边界 / 注意力（唯一强调）
    pub accent_signal: String,
    /// 进程运行
    pub status_running: String,
    /// 警告 / 远端
    pub status_warn: String,
    /// 空闲 / 已退出
    pub status_idle: String,
    /// 需注意（脉冲）
    pub status_attention: String,
}

/// 一个完整风格 = chrome token 组 + 配对终端预置 id（M③ F1 契约 §0/§2）。
///
/// `terminal_theme_id` 必须命中 `builtin_terminal_themes()` 中某个预置的 `id`
/// （契约约束：A→b-dark-graphite / B→b-light-paper / C→b-dark-near-black）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Style {
    pub id: String,
    /// 展示名
    pub name: String,
    pub appearance: ThemeAppearance,
    /// 配对终端预置 id（指向 builtin_terminal_themes 之一，非内联 ANSI）。
    pub terminal_theme_id: String,
    /// chrome 层语义 token。
    pub chrome: ChromeTokens,
}

/// 默认风格 id（M③ F1 契约 §2：B · Paper Terminal）。
pub const DEFAULT_STYLE_ID: &str = "b-paper";

#[allow(clippy::too_many_arguments)]
fn style(
    id: &str,
    name: &str,
    appearance: ThemeAppearance,
    terminal_theme_id: &str,
    chrome: ChromeTokens,
) -> Style {
    Style {
        id: id.to_string(),
        name: name.to_string(),
        appearance,
        terminal_theme_id: terminal_theme_id.to_string(),
        chrome,
    }
}

#[allow(clippy::too_many_arguments)]
fn chrome(
    surface_base: &str,
    surface_chrome: &str,
    surface_raised: &str,
    line_hairline: &str,
    line_soft: &str,
    text_primary: &str,
    text_content: &str,
    text_muted: &str,
    text_faint: &str,
    accent_signal: &str,
    status_running: &str,
    status_warn: &str,
    status_idle: &str,
    status_attention: &str,
) -> ChromeTokens {
    ChromeTokens {
        surface_base: surface_base.to_string(),
        surface_chrome: surface_chrome.to_string(),
        surface_raised: surface_raised.to_string(),
        line_hairline: line_hairline.to_string(),
        line_soft: line_soft.to_string(),
        text_primary: text_primary.to_string(),
        text_content: text_content.to_string(),
        text_muted: text_muted.to_string(),
        text_faint: text_faint.to_string(),
        accent_signal: accent_signal.to_string(),
        status_running: status_running.to_string(),
        status_warn: status_warn.to_string(),
        status_idle: status_idle.to_string(),
        status_attention: status_attention.to_string(),
    }
}

/// 内置三风格（M③ F1 契约 §2，chrome 值 = F1 §2 对应列；配对终端预置）。
/// 默认 = B · Paper Terminal（`DEFAULT_STYLE_ID`）。
pub fn builtin_styles() -> Vec<Style> {
    vec![
        // A · Control Desk（dark）· terminal=b-dark-graphite
        style(
            "a-control-desk",
            "监理台",
            ThemeAppearance::Dark,
            "b-dark-graphite",
            chrome(
                "#0E0F12", "#131519", "#15171C", "#24272E", "#2A2E36", "#E6E9EE",
                "#C7CBD1", "#8A909A", "#6B7079", "#3DD6C4", "#5BE3A0", "#E8B04B",
                "#6B7079", "#3DD6C4",
            ),
        ),
        // B · Paper Terminal（light，默认）· terminal=b-light-paper
        style(
            "b-paper",
            "纸感终端",
            ThemeAppearance::Light,
            "b-light-paper",
            chrome(
                "#F6F1E7", "#EDE5D4", "#FBF7EE", "#DDD3C0", "#E6DECD", "#23201A",
                "#2B2720", "#8A8170", "#A89E8A", "#B5503C", "#6E7B52", "#C08A2E",
                "#B9AE98", "#B5503C",
            ),
        ),
        // C · Phosphor（dark）· terminal=b-dark-near-black
        style(
            "c-phosphor",
            "微辉",
            ThemeAppearance::Dark,
            "b-dark-near-black",
            chrome(
                "#0A1018", "#0F1827", "#101A2A", "#1E2A3C", "#243349", "#DCE7D8",
                "#C6D2E0", "#6E7F94", "#5E7088", "#7FDCA0", "#7FDCA0", "#D6A85B",
                "#46586E", "#7FDCA0",
            ),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_themes_have_unique_ids_and_contain_default() {
        let themes = builtin_terminal_themes();
        assert_eq!(themes.len(), 6);
        let mut ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 6, "id 必须唯一");
        assert!(themes.iter().any(|t| t.id == DEFAULT_TERMINAL_THEME_ID));
    }

    #[test]
    fn theme_serializes_snake_case_for_frontend() {
        let themes = builtin_terminal_themes();
        let json = serde_json::to_string(&themes[0]).unwrap();
        assert!(json.contains("\"selection_background\""));
        assert!(json.contains("\"bright_black\""));
        assert!(json.contains("\"appearance\":\"dark\""));
        // 默认蓝墨底色正确
        assert!(json.contains("#1E2030"));
    }

    // ===== M③ Style 注册表测试（F1 契约 §7：3 style / id 唯一 / 含默认 / theme_id 命中）=====

    #[test]
    fn builtin_styles_have_three_unique_ids_and_contain_default() {
        let styles = builtin_styles();
        assert_eq!(styles.len(), 3, "M③ 恰三风格 A/B/C");
        let mut ids: Vec<&str> = styles.iter().map(|s| s.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 3, "style id 必须唯一");
        assert!(
            styles.iter().any(|s| s.id == DEFAULT_STYLE_ID),
            "必须含默认风格 {DEFAULT_STYLE_ID}"
        );
    }

    #[test]
    fn each_style_terminal_theme_id_hits_an_existing_preset() {
        let themes = builtin_terminal_themes();
        let theme_ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        for s in builtin_styles() {
            assert!(
                theme_ids.contains(&s.terminal_theme_id.as_str()),
                "风格 {} 的 terminal_theme_id={} 必须命中现有预置（不臆造新 ANSI）",
                s.id,
                s.terminal_theme_id
            );
        }
    }

    #[test]
    fn styles_pair_with_contract_specified_presets() {
        // F1 契约 §2 固定配对：A→graphite / B→paper / C→near-black。
        let styles = builtin_styles();
        let by_id = |id: &str| styles.iter().find(|s| s.id == id).expect("style exists");
        assert_eq!(by_id("a-control-desk").terminal_theme_id, "b-dark-graphite");
        assert_eq!(by_id("b-paper").terminal_theme_id, "b-light-paper");
        assert_eq!(by_id("c-phosphor").terminal_theme_id, "b-dark-near-black");
    }

    #[test]
    fn style_serializes_snake_case_chrome_for_frontend() {
        let styles = builtin_styles();
        let paper = styles.iter().find(|s| s.id == "b-paper").unwrap();
        let json = serde_json::to_string(paper).unwrap();
        assert!(json.contains("\"terminal_theme_id\":\"b-light-paper\""));
        assert!(json.contains("\"surface_chrome\""));
        assert!(json.contains("\"accent_signal\""));
        assert!(json.contains("\"status_attention\""));
        assert!(json.contains("\"appearance\":\"light\""));
        // 纸感底色正确（F1 §2 B 列）
        assert!(json.contains("#F6F1E7"));
        assert!(json.contains("#B5503C"));
    }
}
