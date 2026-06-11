use serde::Serialize;
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime, State, WebviewWindow};

use crate::core::{ConfluxError, InstanceId, IslandMode};
use crate::AppState;

const WORKSPACE_WINDOW_LABEL: &str = "main";
const ISLAND_WINDOW_LABEL: &str = "island";
const APP_INDEX_URL: &str = "index.html";
const ISLAND_WINDOW_URL: &str = "index.html?confluxWindow=island";
const COMPACT_DETAIL_RESET_EVENT: &str = "compact-detail-reset";
const DETAIL_RESET_SOURCE_ISLAND_WINDOW: &str = "island_window";
const DETAIL_NONE: &str = "none";
const DETAIL_TOP_ISLAND_EXPANDED: &str = "top_island_expanded";
const DETAIL_TOP_ISLAND_POPOVER: &str = "top_island_popover";
const DETAIL_SIDEBAR_EXPANDED: &str = "sidebar_expanded";
const DETAIL_SIDEBAR_FLOATING: &str = "sidebar_floating";
const TOP_ISLAND_EXPANDED_WIDTH: f64 = 420.0;
const TOP_ISLAND_EXPANDED_CAPSULE_HEIGHT: f64 = 44.0;
const TOP_ISLAND_SHELL_PADDING_Y: f64 = 8.0;
const TOP_ISLAND_VISUAL_SLACK: f64 = 4.0;
const TOP_ISLAND_WINDOW_HEIGHT: f64 =
    TOP_ISLAND_EXPANDED_CAPSULE_HEIGHT + TOP_ISLAND_SHELL_PADDING_Y * 2.0 + TOP_ISLAND_VISUAL_SLACK;
const TOP_ISLAND_POPOVER_HEIGHT: f64 = 244.0;
const TOP_ISLAND_POPOVER_MAX_HEIGHT: f64 = 520.0;
const SIDEBAR_DOCK_TAB_WIDTH: f64 = 48.0;
const SIDEBAR_DOCK_TAB_HEIGHT: f64 = 260.0;
const SIDEBAR_EXPANDED_WIDTH: f64 = 300.0;
const SIDEBAR_FLOATING_HEIGHT: f64 = 720.0;

#[tauri::command]
pub async fn open_workspace_window(app: tauri::AppHandle) -> Result<(), ConfluxError> {
    if let Some(existing_window) = app.get_webview_window(WORKSPACE_WINDOW_LABEL) {
        existing_window.show().map_err(window_error)?;
        existing_window.unminimize().map_err(window_error)?;
        existing_window
            .set_focus()
            .map_err(|e| ConfluxError::WindowError {
                message: format!("Failed to focus workspace window: {e}"),
            })?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        WORKSPACE_WINDOW_LABEL,
        tauri::WebviewUrl::App(APP_INDEX_URL.into()),
    )
    .title("Conflux Workspace")
    .inner_size(1440.0, 900.0)
    .decorations(true)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| ConfluxError::WindowError {
        message: format!("Failed to create workspace window: {e}"),
    })?;

    Ok(())
}

#[tauri::command]
pub async fn focus_agent_card(
    app: tauri::AppHandle,
    instance_id: InstanceId,
) -> Result<(), ConfluxError> {
    app.emit("focus-agent-card", &instance_id)
        .map_err(|e| ConfluxError::WindowError {
            message: format!("Failed to emit focus-agent-card: {e}"),
        })?;

    Ok(())
}

#[tauri::command]
pub async fn switch_island_mode(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    mode: IslandMode,
) -> Result<(), ConfluxError> {
    set_island_mode_and_refresh(&app, state.inner(), mode, false)
}

#[tauri::command]
pub async fn get_island_mode(state: State<'_, AppState>) -> Result<IslandMode, ConfluxError> {
    Ok(state.island_mode.read().clone())
}

#[tauri::command]
pub async fn show_island_window(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), ConfluxError> {
    let mode = state.island_mode.read().clone();
    show_compact_mode_only_for_app(&app, state.inner(), mode)
}

#[tauri::command]
pub async fn hide_island_window(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), ConfluxError> {
    hide_island_window_for_app(&app, state.inner())
}

#[tauri::command]
pub async fn show_workspace_only(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), ConfluxError> {
    show_workspace_only_for_app(&app, state.inner())
}

#[tauri::command]
pub async fn show_compact_mode_only(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    mode: IslandMode,
) -> Result<(), ConfluxError> {
    show_compact_mode_only_for_app(&app, state.inner(), mode)
}

#[tauri::command]
pub async fn debug_island_window_geometry(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<IslandWindowGeometrySnapshot, ConfluxError> {
    island_window_geometry_snapshot_for_app(&app, state.inner())
}

#[tauri::command]
pub async fn set_island_detail_presentation(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    detail: String,
    mode: Option<IslandMode>,
) -> Result<(), ConfluxError> {
    let current_mode = state.island_mode.read().clone();
    if !should_accept_detail_presentation_mode(&current_mode, mode.as_ref()) {
        return Ok(());
    }

    let mode = mode.unwrap_or(current_mode);
    set_island_detail_presentation_for_app(&app, state.inner(), &mode, &detail)
}

#[tauri::command]
pub async fn set_top_island_popover_height(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    height: f64,
) -> Result<(), ConfluxError> {
    set_top_island_popover_height_for_app(&app, state.inner(), height)
}

#[tauri::command]
pub async fn mark_island_window_ready(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), ConfluxError> {
    mark_island_window_ready_for_app(&app, state.inner())
}

#[tauri::command]
pub async fn quit_application<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), ConfluxError> {
    app.cleanup_before_exit();
    app.exit(0);
    Ok(())
}

pub(crate) fn should_restore_window_state(label: &str) -> bool {
    label != ISLAND_WINDOW_LABEL
}

pub(crate) fn show_workspace_only_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
) -> Result<(), ConfluxError> {
    destroy_island_window_for_app(app, state)?;

    let workspace_window = get_workspace_window(app)?;
    workspace_window.show().map_err(window_error)?;
    workspace_window.unminimize().map_err(window_error)?;
    workspace_window.set_focus().map_err(window_error)?;
    Ok(())
}

pub(crate) fn show_compact_mode_only_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
    mode: IslandMode,
) -> Result<(), ConfluxError> {
    prepare_compact_mode_only_for_app(app, state, mode)?;
    present_pending_compact_mode_for_app(app, state)?;
    schedule_compact_ready_fallback(app.clone());
    Ok(())
}

pub(crate) fn hide_island_window_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
) -> Result<(), ConfluxError> {
    destroy_island_window_for_app(app, state)?;
    Ok(())
}

fn prepare_compact_mode_only_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
    mode: IslandMode,
) -> Result<(), ConfluxError> {
    let previous_mode = state.island_mode.read().clone();
    let window_exists = app.get_webview_window(ISLAND_WINDOW_LABEL).is_some();
    let needs_render_ack = compact_window_needs_render_ack(
        window_exists,
        previous_mode != mode,
        *state.island_window_ready.read(),
    );
    let window_transition = compact_mode_window_transition(window_exists, previous_mode != mode);

    if previous_mode != mode {
        reset_compact_window_state(state);
        emit_compact_detail_reset(app, DETAIL_RESET_SOURCE_ISLAND_WINDOW)?;
    }

    {
        let mut current_mode = state.island_mode.write();
        *current_mode = mode.clone();
    }
    *state.pending_compact_show.write() = true;
    if needs_render_ack {
        *state.island_window_ready.write() = false;
    }

    let island_window = match window_transition {
        CompactModeWindowTransition::ReuseExisting | CompactModeWindowTransition::Create => {
            ensure_island_window(app, &mode)?
        }
    };
    let config = island_window_config(&mode);
    apply_island_window_config_for_app(
        app,
        &island_window,
        config.width,
        config.height,
        config.placement,
        config.always_on_top,
    )?;

    match compact_window_bootstrap_visibility(needs_render_ack) {
        visibility @ CompactWindowBootstrapVisibility::PrimeVisible => {
            island_window
                .set_ignore_cursor_events(compact_window_bootstrap_ignores_cursor_events(
                    visibility,
                ))
                .map_err(window_error)?;
            island_window.show().map_err(window_error)?;
            island_window.unminimize().map_err(window_error)?;
            reassert_compact_window_topmost(&island_window, config.always_on_top)?;
        }
        visibility @ CompactWindowBootstrapVisibility::KeepHiddenUntilPresent => {
            island_window
                .set_ignore_cursor_events(compact_window_bootstrap_ignores_cursor_events(
                    visibility,
                ))
                .map_err(window_error)?;
            island_window.hide().map_err(window_error)?;
        }
    }

    if needs_render_ack {
        app.emit("island-mode-changed", &mode)
            .map_err(|e| ConfluxError::WindowError {
                message: format!("Failed to emit island-mode-changed: {e}"),
            })?;
    }

    Ok(())
}

fn mark_island_window_ready_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
) -> Result<(), ConfluxError> {
    *state.island_window_ready.write() = true;
    present_pending_compact_mode_for_app(app, state)?;
    Ok(())
}

fn schedule_compact_ready_fallback<R: Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(180)).await;

        let state = app.state::<AppState>();
        if !should_force_compact_ready_after_timeout(
            *state.pending_compact_show.read(),
            *state.island_window_ready.read(),
        ) {
            return;
        }

        *state.island_window_ready.write() = true;
        if let Err(_error) = present_pending_compact_mode_for_app(&app, state.inner()) {
            #[cfg(debug_assertions)]
            eprintln!("[conflux] compact ready fallback failed: {_error}");
        }
    });
}

fn should_force_compact_ready_after_timeout(
    pending_compact_show: bool,
    island_window_ready: bool,
) -> bool {
    pending_compact_show && !island_window_ready
}

fn schedule_compact_geometry_reassertions<R: Runtime>(app: tauri::AppHandle<R>) {
    for delay_ms in compact_geometry_reassertion_delays() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;

            let Some(island_window) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
                return;
            };

            let state = app.state::<AppState>();
            if let Err(_error) =
                apply_current_island_window_config_for_app(&app, state.inner(), &island_window)
            {
                #[cfg(debug_assertions)]
                eprintln!("[conflux] compact geometry reassert failed: {_error}");
            }
        });
    }
}

fn compact_geometry_reassertion_delays() -> [u64; 2] {
    [50, 180]
}

fn present_pending_compact_mode_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
) -> Result<bool, ConfluxError> {
    if !*state.pending_compact_show.read() || !*state.island_window_ready.read() {
        return Ok(false);
    }

    let Some(island_window) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
        return Ok(false);
    };

    if let Some(workspace_window) = app.get_webview_window(WORKSPACE_WINDOW_LABEL) {
        workspace_window.hide().map_err(window_error)?;
    }

    island_window.show().map_err(window_error)?;
    island_window.unminimize().map_err(window_error)?;
    island_window
        .set_ignore_cursor_events(false)
        .map_err(window_error)?;
    let config = apply_current_island_window_config_for_app(app, state, &island_window)?;
    reassert_compact_window_topmost(&island_window, config.always_on_top)?;
    schedule_compact_geometry_reassertions(app.clone());

    *state.pending_compact_show.write() = false;
    Ok(true)
}

fn reset_compact_window_state(state: &AppState) {
    *state.pending_compact_show.write() = false;
    *state.island_window_ready.write() = false;
    *state.island_detail_presentation.write() = DETAIL_NONE.to_string();
}

fn destroy_island_window_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
) -> Result<bool, ConfluxError> {
    reset_compact_window_state(state);

    let Some(island_window) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
        return Ok(false);
    };

    emit_compact_detail_reset(app, DETAIL_RESET_SOURCE_ISLAND_WINDOW)?;
    island_window.destroy().map_err(window_error)?;
    Ok(true)
}

fn emit_compact_detail_reset<R: Runtime>(
    app: &tauri::AppHandle<R>,
    source: &str,
) -> Result<(), ConfluxError> {
    app.emit(COMPACT_DETAIL_RESET_EVENT, source)
        .map_err(|e| ConfluxError::WindowError {
            message: format!("Failed to emit compact-detail-reset: {e}"),
        })
}

fn set_island_mode_and_refresh<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
    mode: IslandMode,
    force_show: bool,
) -> Result<(), ConfluxError> {
    let island_window_visible = app
        .get_webview_window(ISLAND_WINDOW_LABEL)
        .map(|window| window.is_visible().map_err(window_error))
        .transpose()?
        .unwrap_or(false);
    let workspace_window_visible = app
        .get_webview_window(WORKSPACE_WINDOW_LABEL)
        .map(|window| window.is_visible().map_err(window_error))
        .transpose()?
        .unwrap_or(false);
    if compact_mode_switch_needs_full_refresh(island_window_visible, workspace_window_visible) {
        return show_compact_mode_only_for_app(app, state, mode);
    }

    {
        let mut current_mode = state.island_mode.write();
        *current_mode = mode.clone();
    }
    *state.island_detail_presentation.write() = DETAIL_NONE.to_string();

    app.emit("island-mode-changed", &mode)
        .map_err(|e| ConfluxError::WindowError {
            message: format!("Failed to emit island-mode-changed: {e}"),
        })?;

    let island_window = if force_show {
        Some(ensure_island_window(app, &mode)?)
    } else {
        app.get_webview_window(ISLAND_WINDOW_LABEL)
    };

    if let Some(island_window) = island_window {
        let was_visible = island_window.is_visible().map_err(window_error)?;
        let config = island_window_config(&mode);

        apply_island_window_config_for_app(
            app,
            &island_window,
            config.width,
            config.height,
            config.placement,
            config.always_on_top,
        )?;

        if force_show || was_visible {
            island_window.show().map_err(window_error)?;
            island_window.unminimize().map_err(window_error)?;
            reassert_compact_window_topmost(&island_window, config.always_on_top)?;
            if force_show {
                island_window.set_focus().map_err(window_error)?;
            }
        }
    }

    Ok(())
}

#[allow(dead_code)]
fn get_island_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<WebviewWindow<R>, ConfluxError> {
    app.get_webview_window(ISLAND_WINDOW_LABEL)
        .ok_or_else(|| ConfluxError::WindowError {
            message: "Island window is unavailable".to_string(),
        })
}

fn ensure_island_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    mode: &IslandMode,
) -> Result<WebviewWindow<R>, ConfluxError> {
    if let Some(window) = app.get_webview_window(ISLAND_WINDOW_LABEL) {
        return Ok(window);
    }

    let config = island_window_config(mode);
    let monitor = monitor_metrics_for_app(app)?;
    let geometry =
        resolve_window_geometry(&monitor, config.width, config.height, &config.placement)?;

    let window = tauri::WebviewWindowBuilder::new(
        app,
        ISLAND_WINDOW_LABEL,
        tauri::WebviewUrl::App(compact_webview_url_for_label(ISLAND_WINDOW_LABEL).into()),
    )
    .title("Conflux Island")
    .visible(false)
    .transparent(true)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .inner_size(geometry.width, geometry.height)
    .position(geometry.position.x, geometry.position.y)
    .build()
    .map_err(window_error)?;

    window.set_shadow(false).map_err(window_error)?;

    Ok(window)
}

fn get_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<WebviewWindow<R>, ConfluxError> {
    app.get_webview_window(WORKSPACE_WINDOW_LABEL)
        .ok_or_else(|| ConfluxError::WindowError {
            message: "Workspace window unavailable".to_string(),
        })
}

fn compact_webview_url_for_label(label: &str) -> &'static str {
    match label {
        ISLAND_WINDOW_LABEL => ISLAND_WINDOW_URL,
        _ => APP_INDEX_URL,
    }
}

fn window_error(e: tauri::Error) -> ConfluxError {
    ConfluxError::WindowError {
        message: format!("Window operation failed: {e}"),
    }
}

#[derive(Clone, Copy, Debug)]
struct IslandWindowConfig {
    width: f64,
    height: f64,
    placement: WindowPlacement,
    always_on_top: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IslandDetailPresentation {
    None,
    TopIslandExpanded,
    TopIslandPopover,
    SidebarExpanded,
    SidebarFloating,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum WindowPlacement {
    CenterTopOffset(f64),
    RightEdgeCentered,
    RightEdgeFullHeight,
    TopRightInset { x_margin: f64, y_margin: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompactWindowBootstrapVisibility {
    PrimeVisible,
    KeepHiddenUntilPresent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompactModeWindowTransition {
    ReuseExisting,
    Create,
}

struct MonitorMetrics {
    width: f64,
    height: f64,
    origin_x: f64,
    origin_y: f64,
}

struct WindowGeometry {
    width: f64,
    height: f64,
    position: tauri::LogicalPosition<f64>,
}

#[derive(Debug, Serialize)]
pub struct IslandWindowGeometrySnapshot {
    mode: IslandMode,
    detail: String,
    detail_presentation: String,
    pending_compact_show: bool,
    island_window_ready: bool,
    window_exists: bool,
    visible: Option<bool>,
    app_monitor: MonitorMetricsSnapshot,
    window_monitor: Option<MonitorMetricsSnapshot>,
    expected_config: WindowConfigSnapshot,
    expected_geometry: WindowGeometrySnapshot,
    actual_outer_position_physical: Option<PhysicalPositionSnapshot>,
    actual_outer_size_physical: Option<PhysicalSizeSnapshot>,
    actual_inner_size_physical: Option<PhysicalSizeSnapshot>,
}

#[derive(Debug, Serialize)]
struct MonitorMetricsSnapshot {
    width: f64,
    height: f64,
    origin_x: f64,
    origin_y: f64,
}

#[derive(Debug, Serialize)]
struct WindowConfigSnapshot {
    width: f64,
    height: f64,
    placement: String,
    always_on_top: bool,
}

#[derive(Debug, Serialize)]
struct WindowGeometrySnapshot {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Serialize)]
struct PhysicalPositionSnapshot {
    x: i32,
    y: i32,
}

#[derive(Debug, Serialize)]
struct PhysicalSizeSnapshot {
    width: u32,
    height: u32,
}

fn compact_window_bootstrap_visibility(
    _needs_render_ack: bool,
) -> CompactWindowBootstrapVisibility {
    CompactWindowBootstrapVisibility::KeepHiddenUntilPresent
}

fn compact_window_needs_render_ack(
    window_exists: bool,
    mode_changed: bool,
    island_window_ready: bool,
) -> bool {
    !window_exists || mode_changed || !island_window_ready
}

fn compact_mode_window_transition(
    window_exists: bool,
    _mode_changed: bool,
) -> CompactModeWindowTransition {
    if window_exists {
        CompactModeWindowTransition::ReuseExisting
    } else {
        CompactModeWindowTransition::Create
    }
}

fn compact_mode_switch_needs_full_refresh(
    island_window_visible: bool,
    workspace_window_visible: bool,
) -> bool {
    island_window_visible && !workspace_window_visible
}

fn compact_window_bootstrap_ignores_cursor_events(
    visibility: CompactWindowBootstrapVisibility,
) -> bool {
    visibility == CompactWindowBootstrapVisibility::PrimeVisible
}

fn should_accept_detail_presentation_mode(
    current_mode: &IslandMode,
    requested_mode: Option<&IslandMode>,
) -> bool {
    requested_mode
        .map(|requested_mode| requested_mode == current_mode)
        .unwrap_or(true)
}

fn active_island_window_config(state: &AppState) -> ActiveIslandWindowConfig {
    let mode = state.island_mode.read().clone();
    let detail = state.island_detail_presentation.read().clone();
    let (detail_presentation, config) = island_window_config_for_detail_key(&mode, &detail);

    ActiveIslandWindowConfig {
        mode,
        detail,
        detail_presentation,
        config,
    }
}

struct ActiveIslandWindowConfig {
    mode: IslandMode,
    detail: String,
    detail_presentation: IslandDetailPresentation,
    config: IslandWindowConfig,
}

fn island_window_config_for_detail_key(
    mode: &IslandMode,
    detail: &str,
) -> (IslandDetailPresentation, IslandWindowConfig) {
    let detail_presentation = detail_presentation_for_mode(mode, detail);
    let config = island_window_config_for_detail(mode, detail_presentation);
    (detail_presentation, config)
}

fn island_window_config(mode: &IslandMode) -> IslandWindowConfig {
    island_window_config_for_detail(mode, IslandDetailPresentation::None)
}

fn island_window_config_for_detail(
    mode: &IslandMode,
    detail: IslandDetailPresentation,
) -> IslandWindowConfig {
    match mode {
        IslandMode::TopIsland => IslandWindowConfig {
            width: TOP_ISLAND_EXPANDED_WIDTH,
            height: if detail == IslandDetailPresentation::TopIslandPopover {
                TOP_ISLAND_POPOVER_HEIGHT
            } else {
                TOP_ISLAND_WINDOW_HEIGHT
            },
            placement: WindowPlacement::CenterTopOffset(8.0),
            always_on_top: true,
        },
        IslandMode::Sidebar => IslandWindowConfig {
            width: if detail == IslandDetailPresentation::SidebarExpanded
                || detail == IslandDetailPresentation::SidebarFloating
            {
                SIDEBAR_EXPANDED_WIDTH
            } else {
                SIDEBAR_DOCK_TAB_WIDTH
            },
            height: match detail {
                IslandDetailPresentation::SidebarExpanded => 900.0,
                IslandDetailPresentation::SidebarFloating => SIDEBAR_FLOATING_HEIGHT,
                _ => SIDEBAR_DOCK_TAB_HEIGHT,
            },
            placement: match detail {
                IslandDetailPresentation::SidebarExpanded => WindowPlacement::RightEdgeFullHeight,
                IslandDetailPresentation::SidebarFloating => WindowPlacement::TopRightInset {
                    x_margin: 24.0,
                    y_margin: 72.0,
                },
                _ => WindowPlacement::RightEdgeCentered,
            },
            always_on_top: true,
        },
    }
}

fn apply_current_island_window_config_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
    island_window: &WebviewWindow<R>,
) -> Result<IslandWindowConfig, ConfluxError> {
    let active = active_island_window_config(state);
    let config = active.config;

    apply_island_window_config_for_app(
        app,
        island_window,
        config.width,
        config.height,
        config.placement,
        config.always_on_top,
    )?;

    Ok(config)
}

fn island_window_geometry_snapshot_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
) -> Result<IslandWindowGeometrySnapshot, ConfluxError> {
    let active = active_island_window_config(state);
    let app_monitor = monitor_metrics_for_app(app)?;
    let expected_geometry = resolve_window_geometry(
        &app_monitor,
        active.config.width,
        active.config.height,
        &active.config.placement,
    )?;
    let island_window = app.get_webview_window(ISLAND_WINDOW_LABEL);

    Ok(IslandWindowGeometrySnapshot {
        mode: active.mode,
        detail: active.detail,
        detail_presentation: detail_presentation_label(active.detail_presentation).to_string(),
        pending_compact_show: *state.pending_compact_show.read(),
        island_window_ready: *state.island_window_ready.read(),
        window_exists: island_window.is_some(),
        visible: island_window
            .as_ref()
            .and_then(|window| window.is_visible().ok()),
        app_monitor: monitor_metrics_snapshot(app_monitor),
        window_monitor: island_window
            .as_ref()
            .and_then(|window| monitor_metrics_for_window(window).ok())
            .map(monitor_metrics_snapshot),
        expected_config: window_config_snapshot(active.config),
        expected_geometry: window_geometry_snapshot(expected_geometry),
        actual_outer_position_physical: island_window
            .as_ref()
            .and_then(|window| window.outer_position().ok())
            .map(|position| PhysicalPositionSnapshot {
                x: position.x,
                y: position.y,
            }),
        actual_outer_size_physical: island_window
            .as_ref()
            .and_then(|window| window.outer_size().ok())
            .map(|size| PhysicalSizeSnapshot {
                width: size.width,
                height: size.height,
            }),
        actual_inner_size_physical: island_window
            .as_ref()
            .and_then(|window| window.inner_size().ok())
            .map(|size| PhysicalSizeSnapshot {
                width: size.width,
                height: size.height,
            }),
    })
}

fn set_island_detail_presentation_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
    mode: &IslandMode,
    detail: &str,
) -> Result<(), ConfluxError> {
    let detail = detail_presentation_for_mode(mode, detail);
    let detail_key = detail_key_for_presentation(detail);

    let Some(island_window) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
        if let Some(detail_key) = detail_key_to_store_without_window(detail) {
            *state.island_detail_presentation.write() = detail_key.to_string();
        }
        return Ok(());
    };

    let config = island_window_config_for_detail(mode, detail);

    let result = apply_island_window_config_for_app(
        app,
        &island_window,
        config.width,
        config.height,
        config.placement,
        config.always_on_top,
    );

    if result.is_ok() {
        *state.island_detail_presentation.write() = detail_key.to_string();
    }

    result
}

fn set_top_island_popover_height_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
    height: f64,
) -> Result<(), ConfluxError> {
    let mode = state.island_mode.read().clone();
    let detail = state.island_detail_presentation.read();
    if !should_apply_top_island_popover_height(&mode, &detail) {
        return Ok(());
    }

    let Some(island_window) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
        return Ok(());
    };

    apply_island_window_config_for_app(
        app,
        &island_window,
        TOP_ISLAND_EXPANDED_WIDTH,
        normalize_top_island_popover_height(height),
        WindowPlacement::CenterTopOffset(8.0),
        true,
    )
}

fn normalize_top_island_popover_height(height: f64) -> f64 {
    if !height.is_finite() {
        return TOP_ISLAND_POPOVER_HEIGHT;
    }

    height.clamp(TOP_ISLAND_WINDOW_HEIGHT, TOP_ISLAND_POPOVER_MAX_HEIGHT)
}

fn should_apply_top_island_popover_height(mode: &IslandMode, detail: &str) -> bool {
    *mode == IslandMode::TopIsland && detail == DETAIL_TOP_ISLAND_POPOVER
}

fn detail_presentation_for_mode(mode: &IslandMode, detail: &str) -> IslandDetailPresentation {
    match (mode, detail) {
        (IslandMode::TopIsland, DETAIL_TOP_ISLAND_EXPANDED) => {
            IslandDetailPresentation::TopIslandExpanded
        }
        (IslandMode::TopIsland, DETAIL_TOP_ISLAND_POPOVER) => {
            IslandDetailPresentation::TopIslandPopover
        }
        (IslandMode::Sidebar, DETAIL_SIDEBAR_EXPANDED) => IslandDetailPresentation::SidebarExpanded,
        (IslandMode::Sidebar, DETAIL_SIDEBAR_FLOATING) => IslandDetailPresentation::SidebarFloating,
        _ => IslandDetailPresentation::None,
    }
}

fn detail_key_for_presentation(detail: IslandDetailPresentation) -> &'static str {
    match detail {
        IslandDetailPresentation::None => DETAIL_NONE,
        IslandDetailPresentation::TopIslandExpanded => DETAIL_TOP_ISLAND_EXPANDED,
        IslandDetailPresentation::TopIslandPopover => DETAIL_TOP_ISLAND_POPOVER,
        IslandDetailPresentation::SidebarExpanded => DETAIL_SIDEBAR_EXPANDED,
        IslandDetailPresentation::SidebarFloating => DETAIL_SIDEBAR_FLOATING,
    }
}

fn detail_presentation_label(detail: IslandDetailPresentation) -> &'static str {
    match detail {
        IslandDetailPresentation::None => "none",
        IslandDetailPresentation::TopIslandExpanded => "top_island_expanded",
        IslandDetailPresentation::TopIslandPopover => "top_island_popover",
        IslandDetailPresentation::SidebarExpanded => "sidebar_expanded",
        IslandDetailPresentation::SidebarFloating => "sidebar_floating",
    }
}

fn detail_key_to_store_without_window(detail: IslandDetailPresentation) -> Option<&'static str> {
    match detail {
        IslandDetailPresentation::None => Some(DETAIL_NONE),
        _ => None,
    }
}

fn monitor_metrics_snapshot(metrics: MonitorMetrics) -> MonitorMetricsSnapshot {
    MonitorMetricsSnapshot {
        width: metrics.width,
        height: metrics.height,
        origin_x: metrics.origin_x,
        origin_y: metrics.origin_y,
    }
}

fn window_config_snapshot(config: IslandWindowConfig) -> WindowConfigSnapshot {
    WindowConfigSnapshot {
        width: config.width,
        height: config.height,
        placement: window_placement_label(config.placement),
        always_on_top: config.always_on_top,
    }
}

fn window_geometry_snapshot(geometry: WindowGeometry) -> WindowGeometrySnapshot {
    WindowGeometrySnapshot {
        x: geometry.position.x,
        y: geometry.position.y,
        width: geometry.width,
        height: geometry.height,
    }
}

fn window_placement_label(placement: WindowPlacement) -> String {
    match placement {
        WindowPlacement::CenterTopOffset(y_offset) => format!("center_top_offset:{y_offset}"),
        WindowPlacement::RightEdgeCentered => "right_edge_centered".to_string(),
        WindowPlacement::RightEdgeFullHeight => "right_edge_full_height".to_string(),
        WindowPlacement::TopRightInset { x_margin, y_margin } => {
            format!("top_right_inset:{x_margin}:{y_margin}")
        }
    }
}

fn apply_island_window_config_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window: &WebviewWindow<R>,
    width: f64,
    height: f64,
    placement: WindowPlacement,
    always_on_top: bool,
) -> Result<(), ConfluxError> {
    let app_monitor = monitor_metrics_for_app(app)?;
    let window_monitor = monitor_metrics_for_window(window).ok();
    let monitor = monitor_metrics_for_compact_geometry(window_monitor, app_monitor);
    apply_island_window_config_with_monitor(
        window,
        &monitor,
        width,
        height,
        placement,
        always_on_top,
    )
}

fn monitor_metrics_for_compact_geometry(
    window_monitor: Option<MonitorMetrics>,
    app_monitor: MonitorMetrics,
) -> MonitorMetrics {
    window_monitor.unwrap_or(app_monitor)
}

fn apply_island_window_config_with_monitor<R: Runtime>(
    window: &WebviewWindow<R>,
    monitor: &MonitorMetrics,
    width: f64,
    height: f64,
    placement: WindowPlacement,
    always_on_top: bool,
) -> Result<(), ConfluxError> {
    let geometry = resolve_window_geometry(monitor, width, height, &placement)?;

    window
        .set_position(tauri::LogicalPosition::new(
            geometry.position.x,
            geometry.position.y,
        ))
        .map_err(window_error)?;
    window
        .set_size(tauri::LogicalSize::new(geometry.width, geometry.height))
        .map_err(window_error)?;
    window.set_decorations(false).map_err(window_error)?;
    reassert_compact_window_topmost(window, always_on_top)?;
    window
        .set_position(tauri::LogicalPosition::new(
            geometry.position.x,
            geometry.position.y,
        ))
        .map_err(window_error)?;

    Ok(())
}

fn reassert_compact_window_topmost<R: Runtime>(
    window: &WebviewWindow<R>,
    always_on_top: bool,
) -> Result<(), ConfluxError> {
    window
        .set_always_on_top(always_on_top)
        .map_err(window_error)?;
    window.set_shadow(false).map_err(window_error)?;
    Ok(())
}

fn monitor_metrics_for_window<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<MonitorMetrics, ConfluxError> {
    let monitor = window
        .current_monitor()
        .map_err(|e| ConfluxError::WindowError {
            message: format!("Failed to resolve current monitor: {e}"),
        })?
        .or_else(|| {
            window
                .primary_monitor()
                .map_err(window_error)
                .ok()
                .flatten()
        })
        .or_else(|| {
            window
                .available_monitors()
                .map_err(window_error)
                .ok()
                .and_then(|mut monitors| monitors.drain(..).next())
        })
        .ok_or_else(|| ConfluxError::WindowError {
            message: "No monitor available".to_string(),
        })?;

    let scale_factor = monitor.scale_factor();

    Ok(MonitorMetrics {
        width: monitor.work_area().size.width as f64 / scale_factor,
        height: monitor.work_area().size.height as f64 / scale_factor,
        origin_x: monitor.work_area().position.x as f64 / scale_factor,
        origin_y: monitor.work_area().position.y as f64 / scale_factor,
    })
}

fn monitor_metrics_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<MonitorMetrics, ConfluxError> {
    if let Some(workspace_window) = app.get_webview_window(WORKSPACE_WINDOW_LABEL) {
        if let Ok(metrics) = monitor_metrics_for_window(&workspace_window) {
            return Ok(metrics);
        }
    }

    let monitor = app
        .primary_monitor()
        .map_err(window_error)?
        .or_else(|| {
            app.available_monitors()
                .map_err(window_error)
                .ok()
                .and_then(|mut monitors| monitors.drain(..).next())
        })
        .ok_or_else(|| ConfluxError::WindowError {
            message: "No monitor available".to_string(),
        })?;

    let scale_factor = monitor.scale_factor();

    Ok(MonitorMetrics {
        width: monitor.work_area().size.width as f64 / scale_factor,
        height: monitor.work_area().size.height as f64 / scale_factor,
        origin_x: monitor.work_area().position.x as f64 / scale_factor,
        origin_y: monitor.work_area().position.y as f64 / scale_factor,
    })
}

fn calculate_window_position(
    monitor: &MonitorMetrics,
    width: f64,
    height: f64,
    placement: &WindowPlacement,
) -> Result<tauri::LogicalPosition<f64>, ConfluxError> {
    let position = match placement {
        WindowPlacement::CenterTopOffset(y_offset) => {
            let x = monitor.origin_x + (monitor.width - width) / 2.0;
            tauri::LogicalPosition::new(x, monitor.origin_y + *y_offset)
        }
        WindowPlacement::RightEdgeCentered => {
            let x = monitor.origin_x + monitor.width - width;
            let y = monitor.origin_y + (monitor.height - height) / 2.0;
            tauri::LogicalPosition::new(x, y)
        }
        WindowPlacement::RightEdgeFullHeight => {
            let x = monitor.origin_x + monitor.width - width;
            tauri::LogicalPosition::new(x, monitor.origin_y)
        }
        WindowPlacement::TopRightInset { x_margin, y_margin } => {
            let x = monitor.origin_x + monitor.width - width - x_margin;
            let y = monitor.origin_y + y_margin;
            tauri::LogicalPosition::new(x, y)
        }
    };

    Ok(position)
}

fn resolve_window_geometry(
    monitor: &MonitorMetrics,
    width: f64,
    height: f64,
    placement: &WindowPlacement,
) -> Result<WindowGeometry, ConfluxError> {
    let resolved_height = match placement {
        WindowPlacement::RightEdgeFullHeight => monitor.height,
        _ => height,
    };
    let position = calculate_window_position(monitor, width, resolved_height, placement)?;

    Ok(WindowGeometry {
        width,
        height: resolved_height,
        position,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn island_window_is_skipped_from_initial_restore() {
        assert!(!should_restore_window_state("island"));
        assert!(should_restore_window_state("main"));
        assert!(should_restore_window_state("workspace"));
    }

    #[test]
    fn compact_modes_keep_distinct_window_shapes() {
        let top = island_window_config(&IslandMode::TopIsland);
        assert_eq!(top.width, 420.0);
        assert_eq!(top.height, 64.0);

        let sidebar = island_window_config(&IslandMode::Sidebar);
        assert_eq!(sidebar.width, 48.0);
        assert_eq!(sidebar.height, 260.0);
    }

    #[test]
    fn detail_presentations_keep_top_island_window_shape() {
        let top =
            island_window_config_for_detail(&IslandMode::TopIsland, IslandDetailPresentation::None);
        let top_expanded = island_window_config_for_detail(
            &IslandMode::TopIsland,
            IslandDetailPresentation::TopIslandExpanded,
        );
        assert_eq!(top_expanded.width, top.width);
        assert_eq!(top_expanded.height, top.height);

        let top_detail = island_window_config_for_detail(
            &IslandMode::TopIsland,
            IslandDetailPresentation::TopIslandPopover,
        );
        assert_eq!(top_detail.width, top.width);
        assert_eq!(top_detail.height, 244.0);
    }

    #[test]
    fn measured_top_island_popover_height_is_bounded() {
        assert_eq!(normalize_top_island_popover_height(294.0), 294.0);
        assert_eq!(
            normalize_top_island_popover_height(12.0),
            TOP_ISLAND_WINDOW_HEIGHT
        );
        assert_eq!(
            normalize_top_island_popover_height(999.0),
            TOP_ISLAND_POPOVER_MAX_HEIGHT
        );
        assert_eq!(
            normalize_top_island_popover_height(f64::NAN),
            TOP_ISLAND_POPOVER_HEIGHT
        );
    }

    #[test]
    fn top_island_popover_height_requires_live_popover_detail() {
        assert!(should_apply_top_island_popover_height(
            &IslandMode::TopIsland,
            DETAIL_TOP_ISLAND_POPOVER
        ));
        assert!(!should_apply_top_island_popover_height(
            &IslandMode::TopIsland,
            DETAIL_NONE
        ));
        assert!(!should_apply_top_island_popover_height(
            &IslandMode::Sidebar,
            DETAIL_TOP_ISLAND_POPOVER
        ));
    }

    #[test]
    fn compact_surfaces_are_configured_above_other_windows() {
        assert!(island_window_config(&IslandMode::TopIsland).always_on_top);
        assert!(island_window_config(&IslandMode::Sidebar).always_on_top);
    }

    #[test]
    fn sidebar_uses_dock_tab_until_expanded() {
        let collapsed =
            island_window_config_for_detail(&IslandMode::Sidebar, IslandDetailPresentation::None);
        assert_eq!(collapsed.width, SIDEBAR_DOCK_TAB_WIDTH);
        assert_eq!(collapsed.height, SIDEBAR_DOCK_TAB_HEIGHT);
        assert_eq!(collapsed.placement, WindowPlacement::RightEdgeCentered);

        let expanded = island_window_config_for_detail(
            &IslandMode::Sidebar,
            IslandDetailPresentation::SidebarExpanded,
        );
        assert_eq!(expanded.width, 300.0);
        assert_eq!(expanded.placement, WindowPlacement::RightEdgeFullHeight);

        let floating = island_window_config_for_detail(
            &IslandMode::Sidebar,
            IslandDetailPresentation::SidebarFloating,
        );
        assert_eq!(floating.width, 300.0);
        assert_eq!(floating.height, SIDEBAR_FLOATING_HEIGHT);
        assert_eq!(
            floating.placement,
            WindowPlacement::TopRightInset {
                x_margin: 24.0,
                y_margin: 72.0,
            }
        );
    }

    #[test]
    fn right_edge_dock_tab_geometry_uses_monitor_bounds() {
        let monitor = MonitorMetrics {
            width: 1920.0,
            height: 1040.0,
            origin_x: 0.0,
            origin_y: 40.0,
        };

        let geometry = resolve_window_geometry(
            &monitor,
            SIDEBAR_DOCK_TAB_WIDTH,
            SIDEBAR_DOCK_TAB_HEIGHT,
            &WindowPlacement::RightEdgeCentered,
        )
        .expect("right edge dock geometry should resolve");

        assert_eq!(geometry.width, 48.0);
        assert_eq!(geometry.height, 260.0);
        assert_eq!(geometry.position.x, 1872.0);
        assert_eq!(geometry.position.y, 430.0);
    }

    #[test]
    fn right_edge_dock_tab_geometry_respects_monitor_origin() {
        let monitor = MonitorMetrics {
            width: 1920.0,
            height: 1080.0,
            origin_x: -1920.0,
            origin_y: -20.0,
        };

        let collapsed = resolve_window_geometry(
            &monitor,
            SIDEBAR_DOCK_TAB_WIDTH,
            SIDEBAR_DOCK_TAB_HEIGHT,
            &WindowPlacement::RightEdgeCentered,
        )
        .expect("collapsed sidebar geometry should resolve");
        let expanded = resolve_window_geometry(
            &monitor,
            SIDEBAR_EXPANDED_WIDTH,
            900.0,
            &WindowPlacement::RightEdgeFullHeight,
        )
        .expect("expanded sidebar geometry should resolve");
        let floating = resolve_window_geometry(
            &monitor,
            SIDEBAR_EXPANDED_WIDTH,
            SIDEBAR_FLOATING_HEIGHT,
            &WindowPlacement::TopRightInset {
                x_margin: 24.0,
                y_margin: 72.0,
            },
        )
        .expect("floating sidebar geometry should resolve");

        assert_eq!(collapsed.position.x, -48.0);
        assert_eq!(collapsed.position.y, 390.0);
        assert_eq!(collapsed.height, 260.0);
        assert_eq!(expanded.position.x, -300.0);
        assert_eq!(expanded.position.y, -20.0);
        assert_eq!(expanded.height, 1080.0);
        assert_eq!(floating.position.x, -324.0);
        assert_eq!(floating.position.y, 52.0);
        assert_eq!(floating.height, SIDEBAR_FLOATING_HEIGHT);
    }

    #[test]
    fn top_island_geometry_recenters_after_a_sidebar_window() {
        let monitor = MonitorMetrics {
            width: 1920.0,
            height: 1040.0,
            origin_x: 0.0,
            origin_y: 40.0,
        };
        let top = island_window_config(&IslandMode::TopIsland);

        let geometry = resolve_window_geometry(&monitor, top.width, top.height, &top.placement)
            .expect("top island geometry should resolve");

        assert_eq!(geometry.width, 420.0);
        assert_eq!(geometry.height, 64.0);
        assert_eq!(geometry.position.x, 750.0);
        assert_eq!(geometry.position.y, 48.0);
    }

    #[test]
    fn missing_island_window_only_stores_collapsed_detail_state() {
        assert_eq!(
            detail_key_to_store_without_window(IslandDetailPresentation::None),
            Some(DETAIL_NONE)
        );
        assert_eq!(
            detail_key_to_store_without_window(IslandDetailPresentation::SidebarExpanded),
            None
        );
        assert_eq!(
            detail_key_to_store_without_window(IslandDetailPresentation::TopIslandPopover),
            None
        );
    }

    #[test]
    fn close_action_compact_modes_are_not_quit() {
        assert!(!is_quit_action("top_island"));
        assert!(!is_quit_action("sidebar"));
        assert!(is_quit_action("quit"));
    }

    #[test]
    fn compact_action_values_map_to_island_modes() {
        assert_eq!(
            compact_mode_for_action("top_island"),
            Some(IslandMode::TopIsland)
        );
        assert_eq!(
            compact_mode_for_action("sidebar"),
            Some(IslandMode::Sidebar)
        );
        assert_eq!(compact_mode_for_action("quit"), None);
    }

    #[test]
    fn compact_window_urls_carry_static_bootstrap_window_hint() {
        assert_eq!(
            compact_webview_url_for_label(ISLAND_WINDOW_LABEL),
            "index.html?confluxWindow=island"
        );
    }

    #[test]
    fn compact_window_bootstrap_waits_hidden_while_waiting_for_ready() {
        assert!(compact_window_needs_render_ack(false, false, false));
        assert!(compact_window_needs_render_ack(true, true, true));
        assert!(compact_window_needs_render_ack(true, false, false));
        assert!(!compact_window_needs_render_ack(true, false, true));
        assert!(should_force_compact_ready_after_timeout(true, false));
        assert!(!should_force_compact_ready_after_timeout(false, false));
        assert!(!should_force_compact_ready_after_timeout(true, true));
        assert_eq!(
            compact_window_bootstrap_visibility(true),
            CompactWindowBootstrapVisibility::KeepHiddenUntilPresent
        );
        assert_eq!(
            compact_window_bootstrap_visibility(false),
            CompactWindowBootstrapVisibility::KeepHiddenUntilPresent
        );
        assert!(!compact_window_bootstrap_ignores_cursor_events(
            compact_window_bootstrap_visibility(true)
        ));
        assert!(!compact_window_bootstrap_ignores_cursor_events(
            CompactWindowBootstrapVisibility::KeepHiddenUntilPresent
        ));
    }

    #[test]
    fn compact_mode_change_reuses_existing_island_window() {
        assert_eq!(
            compact_mode_window_transition(true, true),
            CompactModeWindowTransition::ReuseExisting
        );
        assert_eq!(
            compact_mode_window_transition(false, true),
            CompactModeWindowTransition::Create
        );
        assert_eq!(
            compact_mode_window_transition(true, false),
            CompactModeWindowTransition::ReuseExisting
        );
    }

    #[test]
    fn visible_compact_mode_switch_uses_full_refresh_path() {
        assert!(compact_mode_switch_needs_full_refresh(true, false));
        assert!(!compact_mode_switch_needs_full_refresh(false, false));
        assert!(!compact_mode_switch_needs_full_refresh(true, true));
    }

    #[test]
    fn active_config_ignores_stale_sidebar_detail_when_mode_is_top_island() {
        let (detail, config) =
            island_window_config_for_detail_key(&IslandMode::TopIsland, DETAIL_SIDEBAR_EXPANDED);

        assert_eq!(detail, IslandDetailPresentation::None);
        assert_eq!(config.width, TOP_ISLAND_EXPANDED_WIDTH);
        assert_eq!(config.height, TOP_ISLAND_WINDOW_HEIGHT);
        assert_eq!(config.placement, WindowPlacement::CenterTopOffset(8.0));
    }

    #[test]
    fn detail_updates_cannot_switch_the_active_compact_mode() {
        assert!(should_accept_detail_presentation_mode(
            &IslandMode::TopIsland,
            Some(&IslandMode::TopIsland)
        ));
        assert!(should_accept_detail_presentation_mode(
            &IslandMode::TopIsland,
            None
        ));
        assert!(!should_accept_detail_presentation_mode(
            &IslandMode::TopIsland,
            Some(&IslandMode::Sidebar)
        ));
    }

    #[test]
    fn active_config_keeps_sidebar_expanded_width_only_for_sidebar_mode() {
        let (detail, config) =
            island_window_config_for_detail_key(&IslandMode::Sidebar, DETAIL_SIDEBAR_EXPANDED);

        assert_eq!(detail, IslandDetailPresentation::SidebarExpanded);
        assert_eq!(config.width, SIDEBAR_EXPANDED_WIDTH);
        assert_eq!(config.placement, WindowPlacement::RightEdgeFullHeight);

        let (floating_detail, floating_config) =
            island_window_config_for_detail_key(&IslandMode::Sidebar, DETAIL_SIDEBAR_FLOATING);
        assert_eq!(floating_detail, IslandDetailPresentation::SidebarFloating);
        assert_eq!(floating_config.width, SIDEBAR_EXPANDED_WIDTH);
        assert_eq!(
            floating_config.placement,
            WindowPlacement::TopRightInset {
                x_margin: 24.0,
                y_margin: 72.0,
            }
        );
    }

    #[test]
    fn compact_geometry_reassertions_cover_show_and_os_settle() {
        assert_eq!(compact_geometry_reassertion_delays(), [50, 180]);
    }

    #[test]
    fn compact_reassertion_uses_island_window_monitor_when_available() {
        let workspace_monitor = MonitorMetrics {
            width: 1920.0,
            height: 1040.0,
            origin_x: 0.0,
            origin_y: 40.0,
        };
        let island_monitor = MonitorMetrics {
            width: 1920.0,
            height: 1080.0,
            origin_x: -1920.0,
            origin_y: 0.0,
        };

        let selected =
            monitor_metrics_for_compact_geometry(Some(island_monitor), workspace_monitor);

        assert_eq!(selected.origin_x, -1920.0);
        assert_eq!(selected.origin_y, 0.0);
    }
}

#[cfg(test)]
pub(crate) fn is_quit_action(action: &str) -> bool {
    action == "quit"
}

#[cfg(test)]
pub(crate) fn compact_mode_for_action(action: &str) -> Option<IslandMode> {
    match action {
        "top_island" => Some(IslandMode::TopIsland),
        "sidebar" => Some(IslandMode::Sidebar),
        _ => None,
    }
}
