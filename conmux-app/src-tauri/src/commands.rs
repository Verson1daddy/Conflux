// conmux-app — Tauri IPC 命令层（M④ 多会话缩点）。
//
// terminal-core 的 XtermTerminal 硬编的命令（camelCase 参数；Tauri v2 自动把前端
// camelCase 映射到 Rust snake_case 形参）：
//   inject_stdin{instanceId,input} / resize_pty{instanceId,cols,rows}
//   / get_pty_history{instanceId}->string(base64) / is_process_exited{instanceId}->bool
//   / list_terminal_themes()->TerminalTheme[] / list_styles()->Style[]
// M④ 会话管理命令：
//   create_session{program?}->SessionInfo / list_sessions()->SessionInfo[]
//   / kill_session{instanceId}->()
//
// M④ 多 pane（升级自 M② 单 pane）：4 个 PTY 命令**按 instanceId 查 sessions 表路由**
// （兑现多 pane；未知 instanceId → Err，不 panic）。错误一律 `Result<T,String>`
// （D-7，不依赖 conflux 错误类型）。

#[cfg(windows)]
use std::sync::atomic::Ordering;

use tauri::State;

#[cfg(windows)]
use crate::lock;
use crate::{ConmuxState, SessionInfo};

/// 向某会话 pane stdin 注入输入（D-9：前端 string → bytes → AttachSender::send_input）。
///
/// 唯一写链经 daemon 的 `PaneHost::inject_stdin`（source 由接收端赋值 UserDirect，
/// 不过 wire）。M④ 按 `instance_id` 查 sessions 表路由到该会话的 attach 注入半。
#[tauri::command]
pub async fn inject_stdin(
    state: State<'_, ConmuxState>,
    instance_id: String,
    input: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut guard = lock(&state.sessions);
        let handle = guard
            .get_mut(&instance_id)
            .ok_or_else(|| format!("未知会话 {instance_id}（attach 流未就绪 / 已关闭）"))?;
        handle
            .attach_sender
            .send_input(input.as_bytes())
            .map_err(|e| format!("注入失败: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, instance_id, input);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 调整某会话 pane 尺寸（D-8 换序：前端 resize_pty(cols,rows) → AttachSender::resize(rows,cols)，
/// rows 在前——勿传反）。
#[tauri::command]
pub async fn resize_pty(
    state: State<'_, ConmuxState>,
    instance_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut guard = lock(&state.sessions);
        let handle = guard
            .get_mut(&instance_id)
            .ok_or_else(|| format!("未知会话 {instance_id}（attach 流未就绪 / 已关闭）"))?;
        // R-3 / D-8：AttachSender::resize 形参 (rows, cols)。
        handle
            .attach_sender
            .resize(rows, cols)
            .map_err(|e| format!("resize 失败: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, instance_id, cols, rows);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 返回某会话 attach 快照缓存（D-4：base64(mode_preamble ++ history ++ buffered)）。
/// 供新挂载的 XtermTerminal 重放 mount 前画面；live 帧由该会话读线程从 emit 流补上
/// （以 into_split 为边界，不重不漏）。未知会话 → Err。
#[tauri::command]
pub async fn get_pty_history(
    state: State<'_, ConmuxState>,
    instance_id: String,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        let guard = lock(&state.sessions);
        let handle = guard
            .get(&instance_id)
            .ok_or_else(|| format!("未知会话 {instance_id}"))?;
        Ok(handle.history_b64.clone())
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, instance_id);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 某会话本地退出标志（D-5）：该会话读线程收到 `AttachEvent::Exited` 时置 true。
/// 免每次轮询打 ListPanes IPC。未知会话 → 视作已退出（true）——前端轮询去重兜底，
/// 避免对一个已被移除的会话永等（kill 后表项可能已删）。
#[tauri::command]
pub async fn is_process_exited(
    state: State<'_, ConmuxState>,
    instance_id: String,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let guard = lock(&state.sessions);
        match guard.get(&instance_id) {
            Some(handle) => Ok(handle.exited.load(Ordering::SeqCst)),
            None => Ok(true), // 未知 / 已移除 = 不再活跃
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, instance_id);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 新建会话（D-2 默认 powershell）：后端生成 paneId（D-3）→ Spawn → attach → 起读线程
/// → 存 SessionHandle → 返回 SessionInfo（前端据此加入 store + setActive）。
///
/// M⑤b：扩展收 `args`（带参 CLI / `wsl -d Ubuntu`，D-4）+ `cwd`（启动工作目录）。
/// 二者经 SpawnRequest.CommandSpec 透传（conmux crate 已支持）。兼容：
/// `args=None → 空 Vec`、`cwd=None → None`（行为同现状，powershell 默认会话不受影响）。
#[tauri::command]
pub async fn create_session(
    state: State<'_, ConmuxState>,
    #[allow(unused_variables)] app: tauri::AppHandle,
    program: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
) -> Result<SessionInfo, String> {
    #[cfg(windows)]
    {
        let pane_id = state.next_pane_id();
        let program = program.unwrap_or_else(|| crate::DEFAULT_PROGRAM.to_string());
        let args = args.unwrap_or_default();
        crate::spawn_session_into(&app, &state, &pane_id, &program, &args, cwd.as_deref())
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, program, args, cwd);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 列出当前所有会话（前端启动拉取构建缩点条）。返回 instanceId/adapterId/exited。
#[tauri::command]
pub async fn list_sessions(state: State<'_, ConmuxState>) -> Result<Vec<SessionInfo>, String> {
    #[cfg(windows)]
    {
        let guard = lock(&state.sessions);
        let mut out: Vec<SessionInfo> = guard
            .iter()
            .map(|(id, h)| SessionInfo {
                instance_id: id.clone(),
                adapter_id: h.adapter_id.clone(),
                exited: h.exited.load(Ordering::SeqCst),
            })
            .collect();
        // 稳定排序（HashMap 迭代序不定）：default 优先，其余按 instanceId 升序——
        // 缩点条顺序确定、前端 active 顺延可预测。
        out.sort_by(|a, b| {
            let rank = |id: &str| if id == crate::DEFAULT_PANE_ID { 0 } else { 1 };
            rank(&a.instance_id)
                .cmp(&rank(&b.instance_id))
                .then_with(|| a.instance_id.cmp(&b.instance_id))
        });
        Ok(out)
    }
    #[cfg(not(windows))]
    {
        let _ = &state;
        Ok(Vec::new())
    }
}

/// 关闭会话：control.request(KillTree{paneId}) + 从 sessions 移除
/// （该会话读线程随 recv_output 返 None 自然结束，sender 半随表项 drop）。
/// kill 失败仍清表（MF-4 cl.4 语义对齐：本地表与 daemon 状态最终一致，不残留僵尸表项）。
#[tauri::command]
pub async fn kill_session(
    state: State<'_, ConmuxState>,
    instance_id: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use conmux::protocol::{MuxOp, MuxPayload};
        use conmux::types::PaneId;

        // 先发 KillTree（经长连控制连接）。
        let kill_result = {
            let mut guard = lock(&state.control);
            match guard.as_mut() {
                Some(control) => control.request(MuxOp::KillTree {
                    pane_id: PaneId(instance_id.clone()),
                }),
                None => Err(conmux::ConmuxError::PtyError {
                    message: "控制连接未就绪".into(),
                }),
            }
        };
        // 无论 daemon 应答如何，都清本地表项（避免僵尸 + sender 半 drop 断 attach 连接）。
        lock(&state.sessions).remove(&instance_id);
        match kill_result {
            Ok(MuxPayload::Killed) => Ok(()),
            Ok(other) => Err(format!("KillTree 应答非预期: {other:?}")),
            Err(e) => Err(format!("KillTree 失败（本地表项已清）: {e}")),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, instance_id);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 列出 conmux 内置终端主题预置（conmux 是主题数据唯一属主）。
/// 直读机制层注册表——无需走 daemon IPC（主题预置是编译期静态数据）。
#[tauri::command]
pub async fn list_terminal_themes() -> Result<Vec<conmux::TerminalTheme>, String> {
    Ok(conmux::builtin_terminal_themes())
}

/// 列出 conmux 内置风格（M③：chrome 语义 token + 配对终端预置 id）。
/// 直读机制层 `builtin_styles()`——与 list_terminal_themes 同范式（编译期静态、
/// 不走 daemon IPC）。conmux-app 前端据此换 chrome CSS 变量 + 取配对 TerminalTheme
/// 喂 xterm。conflux 不消费 Style（只用 TerminalTheme），故不受影响。
#[tauri::command]
pub async fn list_styles() -> Result<Vec<conmux::Style>, String> {
    Ok(conmux::builtin_styles())
}
