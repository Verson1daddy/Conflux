// ===== 终端主题命令层 =====
// 只读投影：conmux 是主题数据唯一属主（契约 D7 + 产品定位"conmux 可单用"），
// conflux 仅枚举预置供 Settings 选择器消费。选中态是前端展示偏好（localStorage），
// 不落后端——与 island mode 偏好同策略。

use crate::core::ConfluxError;

/// 列出 conmux 内置终端主题预置（含默认 id 由前端常量对齐）。
#[tauri::command]
pub async fn list_terminal_themes() -> Result<Vec<conmux::TerminalTheme>, ConfluxError> {
    Ok(conmux::builtin_terminal_themes())
}

#[cfg(test)]
mod tests {
    #[test]
    fn builtin_themes_exposed_with_default_present() {
        let themes = conmux::builtin_terminal_themes();
        assert!(themes
            .iter()
            .any(|t| t.id == conmux::DEFAULT_TERMINAL_THEME_ID));
    }
}
