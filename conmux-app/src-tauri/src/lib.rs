// conmux-app — Windows CLI 大本营 GUI 壳（Milestone ② daemon GUI 客户端）。
//
// M② 目标：conmux-app 成为 conmux daemon 的首个 GUI 客户端——连 daemon、spawn
// 一个固定 pane（D-6 conmux-default / powershell）、attach 取实时输出、用
// terminal-core 的 XtermTerminal 渲染、键入回传，单 pane 端到端跑通。
//
// 连接模型（D-3）：1 控制连接（Mutex<Option<Client>>，跑 Spawn 等控制态）+ 1 attach
// 连接（into_split → AttachReader 移交读线程 / AttachSender 存入 state）。
//
// 读线程范式照搬 conflux pty/bridge.rs::on_notify + core/event_emit.rs：
//   PaneOutput → base64(data) → emit PtyOutputPayload 到 conmux://pty-output
//   PaneExited → 置退出标志 → emit ProcessExitedPayload 到 conmux://process-exited
// emit fail-soft（R-9）：失败只记 stderr 不 panic；读线程 panic 不拖垮 app。

pub mod commands;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use tauri::{Emitter, Manager};

#[cfg(windows)]
use conmux::client::{AttachEvent, AttachSender, Client};

// ===== 固定单 pane 标识（D-6）=====

/// 单 pane 固定 id：前端硬编 instanceId / 后端 spawn pane_id 一致（PaneId == InstanceId）。
pub const PANE_ID: &str = "conmux-default";
/// adapter id（前端硬编、退出 payload 携带；M② shell 单形态）。
pub const ADAPTER_ID: &str = "pwsh";

// ===== emit 通道（D-2：与前端 setPtyEventChannels 对齐）=====

const PTY_OUTPUT_CHANNEL: &str = "conmux://pty-output";
const PROCESS_EXITED_CHANNEL: &str = "conmux://process-exited";

/// attach 注入半的平台别名：Windows 为真实 `AttachSender`，其它平台为占位（永空）。
#[cfg(windows)]
pub type AttachHandle = AttachSender;
#[cfg(not(windows))]
pub type AttachHandle = ();

/// 控制连接的平台别名：Windows 为真实 `Client`，其它平台为占位（永空）。
#[cfg(windows)]
pub type ControlHandle = Client;
#[cfg(not(windows))]
pub type ControlHandle = ();

/// 跨命令共享态（D-3）。两平台同形（字段集一致），daemon 路径在 Windows 才填充。
pub struct ConmuxState {
    /// 控制连接（Spawn / ListThemes / ListPanes…）。attach 消费独立连接，故控制态长连独立。
    /// `Option`：初始化失败时为 `None`（命令降级返错，不 panic）。
    /// M② 仅 setup 用一次（Spawn）后长期持有保活——尚无控制态命令消费它（ListThemes
    /// 走直读机制层、不打 IPC）；M③/M④ 多会话命令将经此发 Spawn/ListPanes。
    #[allow(dead_code)]
    pub control: Mutex<Option<ControlHandle>>,
    /// attach 注入半（命令线程经此 send_input / resize；读半在读线程）。
    pub attach_sender: Mutex<Option<AttachHandle>>,
    /// 本地退出标志（D-5）：读线程经共享 `Arc<AtomicBool>` 句柄置位，is_process_exited 读它。
    /// 用 Arc 句柄而非 `Mutex<bool>`+try_state：读线程在 app.manage 之前即可 spawn 并直接
    /// 置位，消除「manage 时序竞态导致漏退出」（红队 M2-MED）。
    pub exited: Arc<AtomicBool>,
    /// attach 快照缓存（D-4）：base64(mode_preamble ++ history ++ buffered)。
    pub history_b64: Mutex<String>,
}

impl ConmuxState {
    /// 降级态（daemon 客户端未就绪）：命令对 attach 流返回明确错误，不 panic。
    fn degraded() -> Self {
        Self {
            control: Mutex::new(None),
            attach_sender: Mutex::new(None),
            exited: Arc::new(AtomicBool::new(false)),
            history_b64: Mutex::new(String::new()),
        }
    }
}

/// 中毒容忍取锁（持锁线程 panic 不让后续 lock 级联 panic；临界区皆短，数据一致可用）。
pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// `<exe> daemon` 入口（D-1）：前台跑 conmux daemon，阻塞至 KillServer。
/// 由 main.rs 在 GUI 初始化之前分流（R-8）；Client::connect_or_spawn 自托管拉起本路径。
#[cfg(windows)]
pub fn run_daemon() -> i32 {
    use conmux::daemon::{Daemon, DaemonConfig};
    let config = match DaemonConfig::for_current_user() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[conmux-app daemon] 派生管道名失败: {e}");
            return 1;
        }
    };
    match Daemon::bind(config) {
        Ok(daemon) => {
            eprintln!("[conmux-app daemon] 已启动，监听中…");
            daemon.serve();
            eprintln!("[conmux-app daemon] 已退出。");
            0
        }
        // bind 失败 = 已有 daemon / 被抢注（I-2，不降级）——self-spawn 竞态下的常态。
        Err(e) => {
            eprintln!("[conmux-app daemon] 绑定失败（可能已在运行）: {e}");
            1
        }
    }
}

#[cfg(not(windows))]
pub fn run_daemon() -> i32 {
    eprintln!("[conmux-app daemon] 仅支持 Windows（命名管道 + ConPTY）。");
    1
}

/// 连 daemon → spawn 固定 pane → attach → into_split → 起读线程 + 填 state（Windows）。
/// 失败 ⇒ Err（调用方转 stderr 后以降级态 manage，便于诊断且不阻塞 GUI 启动）。
#[cfg(windows)]
fn connect_spawn_attach(app: &tauri::AppHandle) -> Result<ConmuxState, String> {
    use conmux::pane::{CommandSpec, SpawnRequest};
    use conmux::protocol::{MuxOp, MuxPayload};
    use conmux::types::{PaneId, PaneSize};

    let now_ms = now_millis();

    // 控制连接（D-3）：无 daemon 时自托管拉起 `<exe> daemon`（D-1）。
    let mut control = Client::connect_or_spawn().map_err(|e| format!("连接 daemon 失败: {e}"))?;

    // spawn 固定 pane（D-6：powershell）。pane_id == instanceId。
    let spawn = SpawnRequest {
        pane_id: PaneId(PANE_ID.to_string()),
        command: CommandSpec {
            program: "powershell.exe".to_string(),
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
        },
        size: PaneSize { rows: 30, cols: 120 },
        adapter_id: ADAPTER_ID.to_string(),
        display_name: Some("conmux".to_string()),
        created_at: now_ms,
    };
    match control.request(MuxOp::Spawn(spawn)) {
        Ok(MuxPayload::Spawned(_)) => {}
        Ok(other) => return Err(format!("Spawn 应答非预期: {other:?}")),
        Err(e) => return Err(format!("Spawn 失败: {e}")),
    }

    // attach 连接（D-3）：独立新连，消费它转流式（不能再 request）。
    let attach_client = Client::connect_or_spawn().map_err(|e| format!("attach 连接失败: {e}"))?;
    let attached = attach_client
        .attach(&PaneId(PANE_ID.to_string()))
        .map_err(|e| format!("attach 失败: {e}"))?;

    // D-4 快照缓存：base64(mode_preamble ++ history ++ buffered)。顺序契约（R-4）：
    // preamble → history → buffered（升序、去重已在 client.attach 内完成）。
    let mut snapshot: Vec<u8> = Vec::new();
    snapshot.extend_from_slice(&attached.mode_preamble);
    snapshot.extend_from_slice(&attached.history);
    for (_, data) in &attached.buffered {
        snapshot.extend_from_slice(data);
    }
    let history_b64 = BASE64.encode(&snapshot);

    // into_split（R-1）：reader 入读线程，sender 入 state（不共享同一 stream）。
    let (mut reader, sender) = attached.session.into_split();

    // 退出标志（D-5）用共享 Arc：读线程在 app.manage 之前即可置位，消除时序竞态（红队 M2-MED）。
    let exited = Arc::new(AtomicBool::new(false));
    let exited_for_thread = Arc::clone(&exited);

    let state = ConmuxState {
        control: Mutex::new(Some(control)),
        attach_sender: Mutex::new(Some(sender)),
        exited,
        history_b64: Mutex::new(history_b64),
    };

    // 读线程：recv_output 循环。live 帧（into_split 之后，不重不漏，R-4）→ base64 →
    // emit；Exited → 置退出标志（D-5）+ emit ProcessExited。emit fail-soft（R-9）。
    let app_for_thread = app.clone();
    std::thread::Builder::new()
        .name("conmux-attach-reader".into())
        .spawn(move || {
            while let Some(ev) = reader.recv_output() {
                match ev {
                    AttachEvent::Output { seq, data } => {
                        emit_pty_output(&app_for_thread, &data, seq);
                    }
                    AttachEvent::Exited { exit_code } => {
                        mark_and_emit_exit(&app_for_thread, &exited_for_thread, exit_code);
                        break;
                    }
                }
            }
            // recv_output 返 None（EOF / 背压断连，D-10）：登记退出态（兜底，避免前端永等）。
            // 若上方已因 Exited 置位，mark_and_emit_exit 幂等短路（不重复 emit）。
            mark_and_emit_exit(&app_for_thread, &exited_for_thread, None);
        })
        .map_err(|e| format!("读线程启动失败: {e}"))?;

    Ok(state)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// emit PaneOutput → conmux://pty-output（R-2：裸字节再 base64；R-9 fail-soft）。
#[cfg(windows)]
fn emit_pty_output(app: &tauri::AppHandle, data: &[u8], seq: u64) {
    let payload = serde_json::json!({
        "instance_id": PANE_ID,
        "data": BASE64.encode(data),
        "seq": seq,
        "timestamp": now_millis(),
    });
    if let Err(e) = app.emit(PTY_OUTPUT_CHANNEL, &payload) {
        eprintln!("[conmux-app] emit pty-output 失败: {e}");
    }
}

/// 置退出标志（D-5）+ emit ProcessExited → conmux://process-exited（R-9 fail-soft）。
/// 幂等：已置位则短路不重复 emit（Exited 后 recv_output None 兜底路径静默）。
#[cfg(windows)]
fn mark_and_emit_exit(app: &tauri::AppHandle, exited: &AtomicBool, exit_code: Option<i32>) {
    // swap → true：首次置位返回旧值 false（继续 emit）；已置位返回 true（幂等短路）。
    // 持共享 Arc 句柄、不依赖 app.try_state，故 app.manage 之前置位也不丢（红队 M2-MED）。
    if exited.swap(true, Ordering::SeqCst) {
        return;
    }
    let payload = serde_json::json!({
        "instance_id": PANE_ID,
        "adapter_id": ADAPTER_ID,
        "exit_code": exit_code,
        "signal": serde_json::Value::Null,
        "timestamp": now_millis(),
    });
    if let Err(e) = app.emit(PROCESS_EXITED_CHANNEL, &payload) {
        eprintln!("[conmux-app] emit process-exited 失败: {e}");
    }
}

pub fn run() {
    eprintln!(
        "[conmux-app] starting — conmux protocol v{}",
        conmux::PROTOCOL_VERSION
    );
    tauri::Builder::default()
        .setup(|app| {
            let state = setup_state(&app.handle().clone());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::inject_stdin,
            commands::resize_pty,
            commands::get_pty_history,
            commands::is_process_exited,
            commands::list_terminal_themes,
            commands::list_styles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running conmux-app");
}

/// 装配 state：Windows 走 daemon 客户端路径（失败降级），其它平台直接降级。
#[cfg(windows)]
fn setup_state(app: &tauri::AppHandle) -> ConmuxState {
    match connect_spawn_attach(app) {
        Ok(state) => state,
        Err(e) => {
            // 失败仍起 GUI（前端进 demo 兜底：命令返错、subscribe 收不到帧）。
            eprintln!("[conmux-app] daemon 客户端初始化失败（GUI 仍启动，降级态）: {e}");
            ConmuxState::degraded()
        }
    }
}

#[cfg(not(windows))]
fn setup_state(_app: &tauri::AppHandle) -> ConmuxState {
    eprintln!("[conmux-app] 非 Windows：daemon 客户端不可用，进入降级态。");
    ConmuxState::degraded()
}
