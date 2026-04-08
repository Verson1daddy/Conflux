// ===== 窗口管理命令层 =====
// 提供灵动岛模式切换、工作台窗口管理等 Tauri IPC 命令
// 灵动岛有三种模式：TopIsland（顶部岛）、Sidebar（侧边栏）、FloatBall（悬浮球）
// 工作台窗口为独立窗口，通过 WebviewWindowBuilder 创建

use tauri::{Emitter, Manager, State};

use crate::AppState;
use crate::core::{ConfluxError, InstanceId, IslandMode};

/// 打开工作台窗口
///
/// 创建一个新的独立工作台窗口，尺寸 1440x900，带窗口装饰，
/// 标题为 "Conflux Workspace"。如果工作台窗口已存在，则聚焦到该窗口。
///
/// # 参数
/// - `app`: Tauri AppHandle，用于创建和管理窗口
#[tauri::command]
pub async fn open_workspace_window(app: tauri::AppHandle) -> Result<(), ConfluxError> {
    // 检查工作台窗口是否已存在
    if let Some(existing_window) = app.get_webview_window("workspace") {
        // 窗口已存在，聚焦并置前
        existing_window.set_focus().map_err(|e| ConfluxError::WindowError {
            message: format!("无法聚焦工作台窗口: {}", e),
        })?;
        return Ok(());
    }

    // 创建新的工作台窗口
    let _workspace_window = tauri::WebviewWindowBuilder::new(
        &app,
        "workspace",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Conflux Workspace")
    .inner_size(1440.0, 900.0)
    .decorations(true)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| ConfluxError::WindowError {
        message: format!("无法创建工作台窗口: {}", e),
    })?;

    Ok(())
}

/// 聚焦到指定 Agent 卡片
///
/// 通过 Tauri 事件系统向前端发送 "focus-agent-card" 事件，
/// 前端收到后滚动/切换到对应的 Agent 卡片。
///
/// # 参数
/// - `app`: Tauri AppHandle，用于发送全局事件
/// - `instance_id`: 要聚焦的 Agent 实例标识
#[tauri::command]
pub async fn focus_agent_card(
    app: tauri::AppHandle,
    instance_id: InstanceId,
) -> Result<(), ConfluxError> {
    // 向前端发送聚焦事件
    app.emit("focus-agent-card", &instance_id)
        .map_err(|e| ConfluxError::WindowError {
            message: format!("无法发送聚焦事件: {}", e),
        })?;

    Ok(())
}

/// 切换灵动岛模式
///
/// 更新全局灵动岛模式状态，并根据新模式调整 "island" 窗口的尺寸、位置和属性。
/// 三种模式对应不同的窗口配置：
/// - TopIsland: 400x48, 居中, y=8, 无装饰, 置顶
/// - Sidebar: 420x800, 右侧边缘, 无装饰
/// - FloatBall: 64x64, 右下角, 无装饰, 置顶
///
/// # 参数
/// - `state`: 全局应用状态
/// - `app`: Tauri AppHandle，用于获取和操作窗口
/// - `mode`: 目标灵动岛模式
#[tauri::command]
pub async fn switch_island_mode(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    mode: IslandMode,
) -> Result<(), ConfluxError> {
    // 1. 更新全局模式状态
    {
        let mut current_mode = state.island_mode.write();
        *current_mode = mode.clone();
    }

    // 2. 获取灵动岛窗口
    let island_window = app
        .get_webview_window("island")
        .ok_or_else(|| ConfluxError::WindowError {
            message: "灵动岛窗口不存在".to_string(),
        })?;

    // 3. 根据模式调整窗口属性
    match mode {
        IslandMode::TopIsland => {
            apply_island_window_config(
                &island_window,
                400.0,
                48.0,
                WindowPlacement::CenterTopOffset(8.0),
                true, // always_on_top
            )?;
        }
        IslandMode::Sidebar => {
            apply_island_window_config(
                &island_window,
                420.0,
                800.0,
                WindowPlacement::RightEdge,
                false, // not always_on_top
            )?;
        }
        IslandMode::FloatBall => {
            apply_island_window_config(
                &island_window,
                64.0,
                64.0,
                WindowPlacement::BottomRight,
                true, // always_on_top
            )?;
        }
    }

    // 4. 通知前端模式已切换
    app.emit("island-mode-changed", &state.island_mode.read().clone())
        .map_err(|e| ConfluxError::WindowError {
            message: format!("无法发送模式切换事件: {}", e),
        })?;

    Ok(())
}

/// 获取当前灵动岛模式
///
/// # 返回
/// 当前的灵动岛模式枚举值
#[tauri::command]
pub async fn get_island_mode(
    state: State<'_, AppState>,
) -> Result<IslandMode, ConfluxError> {
    let mode = state.island_mode.read().clone();
    Ok(mode)
}

// ===== 内部辅助类型和函数 =====

/// 窗口放置策略
enum WindowPlacement {
    /// 顶部居中，带垂直偏移
    CenterTopOffset(f64),
    /// 右侧边缘
    RightEdge,
    /// 右下角
    BottomRight,
}

/// 应用灵动岛窗口配置
///
/// 统一设置窗口的尺寸、位置、装饰和置顶属性。
fn apply_island_window_config(
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
    placement: WindowPlacement,
    always_on_top: bool,
) -> Result<(), ConfluxError> {
    /// 将 tauri::Error 转换为 ConfluxError::WindowError
    fn win_err(e: tauri::Error) -> ConfluxError {
        ConfluxError::WindowError {
            message: format!("窗口配置失败: {}", e),
        }
    }

    // 设置窗口尺寸
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(win_err)?;

    // 移除窗口装饰
    window.set_decorations(false).map_err(win_err)?;

    // 设置是否置顶
    window.set_always_on_top(always_on_top).map_err(win_err)?;

    // 计算并设置窗口位置
    let position = calculate_window_position(window, width, height, &placement)?;
    window
        .set_position(position)
        .map_err(win_err)?;

    Ok(())
}

/// 计算窗口位置
///
/// 根据放置策略和当前显示器分辨率计算窗口的逻辑坐标。
fn calculate_window_position(
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
    placement: &WindowPlacement,
) -> Result<tauri::LogicalPosition<f64>, ConfluxError> {
    // 获取当前显示器信息
    let monitor = window.current_monitor().map_err(|e| ConfluxError::WindowError {
        message: format!("无法获取显示器信息: {}", e),
    })?;

    let monitor = monitor.ok_or_else(|| ConfluxError::WindowError {
        message: "未找到当前显示器".to_string(),
    })?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();

    // 将物理像素转换为逻辑像素
    let screen_width = monitor_size.width as f64 / scale_factor;
    let screen_height = monitor_size.height as f64 / scale_factor;

    let position = match placement {
        WindowPlacement::CenterTopOffset(y_offset) => {
            let x = (screen_width - width) / 2.0;
            tauri::LogicalPosition::new(x, *y_offset)
        }
        WindowPlacement::RightEdge => {
            let x = screen_width - width;
            let y = (screen_height - height) / 2.0;
            tauri::LogicalPosition::new(x, y)
        }
        WindowPlacement::BottomRight => {
            let margin = 16.0;
            let x = screen_width - width - margin;
            let y = screen_height - height - margin;
            tauri::LogicalPosition::new(x, y)
        }
    };

    Ok(position)
}
