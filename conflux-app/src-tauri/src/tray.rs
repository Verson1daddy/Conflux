use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Runtime,
};

use crate::commands::window::{show_compact_mode_only_for_app, show_workspace_only_for_app};
use crate::core::IslandMode;
use crate::AppState;

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

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("No default window icon found")?;

    TrayIconBuilder::new()
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
}
