// conmux-app — Tauri IPC 命令层（M② daemon GUI 客户端，单 pane e2e）。
//
// terminal-core 的 XtermTerminal 硬编 5 个命令（camelCase 参数；Tauri v2 自动把
// 前端 camelCase 映射到 Rust snake_case 形参）：
//   inject_stdin{instanceId,input} / resize_pty{instanceId,cols,rows}
//   / get_pty_history{instanceId}->string(base64) / is_process_exited{instanceId}->bool
//   / list_terminal_themes()->TerminalTheme[]
//
// M② 单 pane（D-6）：instanceId 恒为固定 pane_id（conmux-default），命令对 state 的
// 单一 attach 流操作。错误一律 `Result<T,String>`（D-7，不依赖 conflux 错误类型）。

use std::sync::atomic::Ordering;

use tauri::State;

use crate::{lock, ConmuxState};

/// 向 pane stdin 注入输入（D-9：前端 string → bytes → AttachSender::send_input）。
///
/// 唯一写链经 daemon 的 `PaneHost::inject_stdin`（source 由接收端赋值 UserDirect，
/// 不过 wire）。`instance_id` M② 单 pane 下恒为固定 pane_id；签名保留以对齐
/// terminal-core 命令契约（多会话 M④ 再据此路由）。
#[tauri::command]
pub async fn inject_stdin(
    state: State<'_, ConmuxState>,
    instance_id: String,
    input: String,
) -> Result<(), String> {
    let _ = instance_id; // 单 pane：固定流，instance_id 仅契约对齐
    #[cfg(windows)]
    {
        let mut guard = lock(&state.attach_sender);
        let sender = guard
            .as_mut()
            .ok_or_else(|| "attach 流未就绪（pane 尚未连上 daemon）".to_string())?;
        sender
            .send_input(input.as_bytes())
            .map_err(|e| format!("注入失败: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, input);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 调整 pane 尺寸（D-8 换序：前端 resize_pty(cols,rows) → AttachSender::resize(rows,cols)，
/// rows 在前——勿传反）。
#[tauri::command]
pub async fn resize_pty(
    state: State<'_, ConmuxState>,
    instance_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let _ = instance_id; // 单 pane
    #[cfg(windows)]
    {
        let mut guard = lock(&state.attach_sender);
        let sender = guard
            .as_mut()
            .ok_or_else(|| "attach 流未就绪（pane 尚未连上 daemon）".to_string())?;
        // R-3 / D-8：AttachSender::resize 形参 (rows, cols)。
        sender
            .resize(rows, cols)
            .map_err(|e| format!("resize 失败: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, cols, rows);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 返回 attach 快照缓存（D-4：base64(mode_preamble ++ history ++ buffered)）。
/// 供新挂载的 XtermTerminal 重放 mount 前画面；live 帧由读线程从 emit 流补上
/// （以 into_split 为边界，不重不漏）。
#[tauri::command]
pub async fn get_pty_history(
    state: State<'_, ConmuxState>,
    instance_id: String,
) -> Result<String, String> {
    let _ = instance_id; // 单 pane
    Ok(lock(&state.history_b64).clone())
}

/// 本地退出标志（D-5）：读线程收到 `AttachEvent::Exited` 时置 true。
/// 免每次轮询打 ListPanes IPC。
#[tauri::command]
pub async fn is_process_exited(
    state: State<'_, ConmuxState>,
    instance_id: String,
) -> Result<bool, String> {
    let _ = instance_id; // 单 pane
    Ok(state.exited.load(Ordering::SeqCst))
}

/// 列出 conmux 内置终端主题预置（conmux 是主题数据唯一属主）。
/// 直读机制层注册表——无需走 daemon IPC（主题预置是编译期静态数据）。
#[tauri::command]
pub async fn list_terminal_themes() -> Result<Vec<conmux::TerminalTheme>, String> {
    Ok(conmux::builtin_terminal_themes())
}
