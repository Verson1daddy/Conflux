use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, Theme,
};

use crate::commands::window::{show_compact_mode_only_for_app, show_workspace_only_for_app};
use crate::core::IslandMode;
use crate::AppState;

/// 托盘图标 id（lib.rs ThemeChanged 事件据此 tray_by_id 热切换）。
const TRAY_ID: &str = "conflux-tray";

/// 双主题托盘字形（无背景、同 bundle 5 瓣原构图，仅换色）：
///   深色任务栏 → 米白字形（tray-cream）；浅色任务栏 → 近黑字形（tray-ink）。
/// 系统图标桌面其余处保持固定原图（暗图米白），仅托盘破例随任务栏主题取对比色。
/// 嵌入原始 RGBA（32×32×4=4096B，由 PNG 预转）——`Image::new` 是 const fn、无需 image-png feature。
const TRAY_SIZE: u32 = 32;
const TRAY_CREAM: &[u8] = include_bytes!("../icons/tray-cream.rgba");
const TRAY_INK: &[u8] = include_bytes!("../icons/tray-ink.rgba");

/// 主题 → 托盘 RGBA（深色/未知任务栏取米白、浅色任务栏取近黑）。纯选择，便于单测。
fn tray_rgba_for_theme(theme: Theme) -> &'static [u8] {
    match theme {
        Theme::Light => TRAY_INK,
        _ => TRAY_CREAM,
    }
}

/// 主题 → 托盘图标（保证对比可见）。
fn tray_icon_for_theme(theme: Theme) -> Image<'static> {
    Image::new(tray_rgba_for_theme(theme), TRAY_SIZE, TRAY_SIZE)
}

/// 主窗口当前主题（拿不到则按深色兜底——米白字形，深色任务栏是 Windows 默认）。
fn current_theme<R: Runtime>(app: &tauri::App<R>) -> Theme {
    app.get_webview_window("main")
        .and_then(|w| w.theme().ok())
        .unwrap_or(Theme::Dark)
}

/// 系统主题切换时热替托盘图标（lib.rs on_window_event ThemeChanged 调用）。
pub fn update_tray_icon_for_theme<R: Runtime>(app: &AppHandle<R>, theme: Theme) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let r = tray.set_icon(Some(tray_icon_for_theme(theme)));
        eprintln!("[tray] theme changed → {theme:?}, set_icon ok={}", r.is_ok());
    } else {
        eprintln!("[tray] theme changed → {theme:?} but tray_by_id 未找到");
    }
}

pub fn create_tray<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let suppress_next_restore = Arc::new(AtomicBool::new(false));
    let show_workspace_item =
        MenuItem::with_id(app, "show-workspace", "Show Workspace", true, None::<&str>)?;
    let show_capsule_item = MenuItem::with_id(
        app,
        "show-capsule",
        "Show Dynamic Island",
        true,
        None::<&str>,
    )?;
    let show_sidebar_item =
        MenuItem::with_id(app, "show-sidebar", "Show Sidebar", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_workspace_item,
            &separator,
            &show_capsule_item,
            &show_sidebar_item,
            &separator,
            &quit_item,
        ],
    )?;

    // 托盘破例随任务栏主题取对比色（方案 B）：启动按 main 窗口主题选初始图标，
    // lib.rs ThemeChanged 事件热切换。其余系统图标仍固定原图。
    let theme = current_theme(app);
    eprintln!("[tray] building with initial theme={theme:?}");
    let icon = tray_icon_for_theme(theme);

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event({
            let suppress_next_restore = Arc::clone(&suppress_next_restore);
            move |app_handle, event| match event.id.as_ref() {
                "show-workspace" => {
                    let state = app_handle.state::<AppState>();
                    let _ = show_workspace_only_for_app(app_handle, state.inner());
                }
                "show-capsule" => {
                    arm_tray_menu_action_suppression(&suppress_next_restore);
                    schedule_tray_menu_action_suppression_clear(Arc::clone(&suppress_next_restore));
                    let state = app_handle.state::<AppState>();
                    let _ = show_compact_mode_only_for_app(
                        app_handle,
                        state.inner(),
                        IslandMode::TopIsland,
                    );
                }
                "show-sidebar" => {
                    arm_tray_menu_action_suppression(&suppress_next_restore);
                    schedule_tray_menu_action_suppression_clear(Arc::clone(&suppress_next_restore));
                    let state = app_handle.state::<AppState>();
                    let _ = show_compact_mode_only_for_app(
                        app_handle,
                        state.inner(),
                        IslandMode::Sidebar,
                    );
                }
                "quit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event({
            let suppress_next_restore = Arc::clone(&suppress_next_restore);
            move |tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    if !should_restore_workspace_from_tray_left_click(&suppress_next_restore) {
                        return;
                    }

                    let state = tray.app_handle().state::<AppState>();
                    let _ = show_workspace_only_for_app(tray.app_handle(), state.inner());
                }
            }
        })
        .build(app)?;

    eprintln!("[tray] created ok (id={TRAY_ID})");
    Ok(())
}

fn arm_tray_menu_action_suppression(suppress_next_restore: &AtomicBool) {
    suppress_next_restore.store(true, Ordering::SeqCst);
}

fn should_restore_workspace_from_tray_left_click(suppress_next_restore: &AtomicBool) -> bool {
    !suppress_next_restore.swap(false, Ordering::SeqCst)
}

fn schedule_tray_menu_action_suppression_clear(suppress_next_restore: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(600)).await;
        suppress_next_restore.store(false, Ordering::SeqCst);
    });
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;

    #[test]
    fn tray_left_click_restore_is_suppressed_once_after_menu_action() {
        let suppress_next_restore = AtomicBool::new(false);

        arm_tray_menu_action_suppression(&suppress_next_restore);

        assert!(!should_restore_workspace_from_tray_left_click(
            &suppress_next_restore
        ));
        assert!(should_restore_workspace_from_tray_left_click(
            &suppress_next_restore
        ));
    }

    #[test]
    fn tray_left_click_restores_workspace_without_recent_menu_action() {
        let suppress_next_restore = AtomicBool::new(false);

        assert!(should_restore_workspace_from_tray_left_click(
            &suppress_next_restore
        ));
    }

    #[test]
    fn tray_theme_icons_are_distinct_and_correctly_sized() {
        let expected = (TRAY_SIZE * TRAY_SIZE * 4) as usize;
        assert_eq!(TRAY_CREAM.len(), expected, "cream RGBA = 32x32x4");
        assert_eq!(TRAY_INK.len(), expected, "ink RGBA = 32x32x4");
        // 两主题字形必须不同（否则切换无意义）。
        assert_ne!(TRAY_CREAM, TRAY_INK);
    }

    #[test]
    fn tray_rgba_maps_theme_to_contrasting_glyph() {
        // 浅色任务栏 → 近黑(ink)；深色/未知 → 米白(cream)。守色彩映射不被反置。
        assert_eq!(tray_rgba_for_theme(Theme::Light), TRAY_INK);
        assert_eq!(tray_rgba_for_theme(Theme::Dark), TRAY_CREAM);
    }
}
