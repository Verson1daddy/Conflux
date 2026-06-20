// conmux-app — Windows CLI 大本营 GUI 壳（Milestone ④ 多会话缩点）。
//
// M④ 目标（升级自 M② 单 pane）：把后端从「固定单 pane」升级为「per-pane 注册表」，
// 让缩点条真正发力——N 个会话各有独立 attach 连接、独立 reader 线程、独立退出标志，
// 命令按 instanceId（== daemon paneId）路由；新增 create/list/kill 会话命令；
// daemon 是 tmux-server 模型（全 pane 属主），M② 单 pane 同款 ×N。
//
// 连接模型：1 控制连接（Mutex<Option<Client>>，跑 Spawn/KillTree 等控制态，长连）
// + 每会话 1 attach 连接（into_split → reader 半移交读线程 / sender 半存 SessionHandle）。
// 控制连接已确证 daemon 在跑，故各会话 attach 用 `Client::connect`（具名管道，不重复
// connect_or_spawn 的翻倍退避，D-4）；取管道名经 conmux::pipe::default_pipe_name
// （module pub，无需 re-export）。取名失败时回退 connect_or_spawn（功能正确，仅退避翻倍）。
//
// 读线程范式照搬 M②（conflux pty/bridge.rs::on_notify + core/event_emit.rs）：
//   PaneOutput → base64(data) → emit PtyOutputPayload 到 conmux://pty-output（instance_id=该 paneId）
//   PaneExited → 置该会话退出标志 → emit ProcessExitedPayload 到 conmux://process-exited
// emit fail-soft（R-9）：失败只记 stderr 不 panic；读线程 panic 不拖垮 app。
//
// 防竞态（D-5，沿用 M②）：每会话一个 `Arc<AtomicBool> exited`，读线程持共享句柄、
// 在 SessionHandle 入表之前即可置位，消除「入表时序竞态导致漏退出」（红队 M2-MED）。

pub mod commands;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use tauri::{Emitter, Manager};

#[cfg(windows)]
use conmux::client::{AttachEvent, AttachSender, Client};

// ===== 固定标识 =====

/// 初始会话 paneId（启动时 create 的默认 powershell 会话，保持 M② 行为）。
pub const DEFAULT_PANE_ID: &str = "conmux-default";
/// 默认 adapter id（M④ shell 单形态；CLI 选择器 = 后续）。
pub const ADAPTER_ID: &str = "pwsh";
/// 新建会话默认程序（D-2：powershell；CLI 选择器 = 后续登记）。
pub const DEFAULT_PROGRAM: &str = "powershell.exe";

/// finding-2：PowerShell 默认不发 OSC7 → conmux aware-header cwd 恒「—」。给 conmux 自起的
/// powershell（**无显式 args 时**）经 `-EncodedCommand` 注入 prompt 包裹器，每次提示吐一条
/// OSC7（`ESC]7;file:///<path>ESC\`）让 cwd 实时上报。**只作用于 conmux 起的 powershell
/// 会话**，不碰用户全局 $PROFILE；包裹现有 prompt（保留 conda "(base)" 等原貌）。用
/// `-EncodedCommand`（UTF-16LE+base64）而非 `-Command`——base64 纯 ASCII，避 argv 引号地狱。
// 路径**逐段 percent-encode**（红队 SF：osc7.ts 解析端 decodeURIComponent，发射端不编码会
// 让含 `%`/空格的真路径被误解码成错目录）。按 [\\/] 拆段、各段 EscapeDataString、`/` 重接，
// 盘符 "C:" → "C%3A"（解析端 decode 回 "C:"，再去前导 / 还原盘符路径）。
const PS_OSC7_SETUP: &str = r#"$__op=$function:prompt; function global:prompt { $p=(Get-Location).ProviderPath; $e=($p -split '[\\/]' | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'; [Console]::Write("$([char]27)]7;file:///$e$([char]27)\"); if($__op){& $__op}else{"PS $p> "} }"#;

/// program 是否 PowerShell（按 basename 判，大小写无关）。
fn is_powershell(program: &str) -> bool {
    let base = std::path::Path::new(program)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();
    matches!(
        base.as_str(),
        "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
    )
}

/// conmux 自起 powershell 的 OSC7 注入 args：`-NoExit -EncodedCommand <base64(UTF-16LE setup)>`。
fn powershell_osc7_args() -> Vec<String> {
    let utf16: Vec<u8> = PS_OSC7_SETUP
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    vec![
        "-NoExit".to_string(),
        "-EncodedCommand".to_string(),
        BASE64.encode(&utf16),
    ]
}

// ===== emit 通道（与前端 setPtyEventChannels 对齐）=====

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

/// 单会话句柄（per-pane 注册表的值）。reader 半 move 进各自后台读线程，不入此结构。
pub struct SessionHandle {
    /// attach 注入半（命令线程经此 send_input / resize）。
    pub attach_sender: AttachHandle,
    /// 本地退出标志（D-5）：该会话读线程经共享 `Arc<AtomicBool>` 句柄置位，
    /// is_process_exited 读它。用 Arc 句柄而非 try_state，消除入表时序竞态（红队 M2-MED）。
    pub exited: Arc<AtomicBool>,
    /// attach 快照缓存（D-4）：base64(mode_preamble ++ history ++ buffered)，供新挂载终端重放。
    pub history_b64: String,
    /// adapter id（退出 payload 携带 / list_sessions 返回）。
    pub adapter_id: String,
}

/// 会话元信息（serde，前端镜像 SessionInfo）。
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub instance_id: String,
    pub adapter_id: String,
    pub exited: bool,
}

/// Slice 3：spawn 被信任校验拒绝的结构化错误（前端据此弹 pin UI）。
///
/// 经 `spawn_session_into` 的 `Err(String)` 通道传给前端——序列化为 JSON 字符串，
/// 前端 `createSession` JSON.parse 后按 `kind` 分流。`pinnable=true` 表示可经
/// `trust_pin_executable` 自助信任后重试（无签名 shim/exe 均属此类）。
///
/// **注意**：`program` 是真正被拒的目标（shim 或 exe），**非 cmd.exe 包裹层**——
/// 内核 cmd-wrap 加固后，拒绝错误指向 args 里的 shim 路径，UI 据此 pin 正确目标。
#[derive(Debug, Clone, Serialize)]
pub struct SpawnUntrustedError {
    /// 固定 `"UntrustedProgram"`（前端 type guard）。
    pub kind: &'static str,
    /// 被拒的绝对路径（shim 或 exe）。
    pub program: String,
    /// 内核拒绝原因（未签名 / 哈希不匹配等）。
    pub reason: String,
    /// true = 可 pin 后重试。
    pub pinnable: bool,
}

/// 跨命令共享态（M④ 多 pane）。两平台同形（字段集一致），daemon 路径在 Windows 才填充。
pub struct ConmuxState {
    /// 控制连接（Spawn / KillTree…），长连。attach 各会话独立连接，故控制态长连独立。
    /// `Option`：初始化失败时为 `None`（命令降级返错，不 panic）。
    pub control: Mutex<Option<ControlHandle>>,
    /// per-pane 注册表：paneId（== instanceId）→ SessionHandle。命令按 instanceId 查表路由。
    pub sessions: Mutex<HashMap<String, SessionHandle>>,
    /// 后端生成 paneId 的自增计数（D-3：前端不造 id，避碰撞）。
    pub next_pane_seq: AtomicU64,
}

impl ConmuxState {
    /// 降级态（daemon 客户端未就绪）：命令对 attach 流返回明确错误，不 panic。
    fn degraded() -> Self {
        Self {
            control: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            next_pane_seq: AtomicU64::new(1),
        }
    }

    /// 生成下一个会话 paneId（D-3）。`conmux-<seq>`，与初始 `conmux-default` 不碰撞。
    fn next_pane_id(&self) -> String {
        let n = self.next_pane_seq.fetch_add(1, Ordering::SeqCst);
        format!("conmux-{n}")
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

/// 连 daemon → spawn 初始 pane → 装配 state（Windows）。
/// 失败 ⇒ Err（调用方转 stderr 后以降级态 manage，便于诊断且不阻塞 GUI 启动）。
#[cfg(windows)]
fn connect_and_setup(app: &tauri::AppHandle) -> Result<ConmuxState, String> {
    // 控制连接（D-3）：无 daemon 时自托管拉起 `<exe> daemon`（D-1）。这一次确证 daemon 在跑。
    let mut control = Client::connect_or_spawn().map_err(|e| format!("连接 daemon 失败: {e}"))?;
    // 读超时（红队 SF-1）：wedged-but-alive daemon 下控制请求最多阻塞 5s 即返 Err，不再无限
    // 持锁。Spawn/KillTree/ListPanes 等本地操作远快于 5s；心跳探活超时即判 daemon 不应答（死）。
    // **不变量（红队 SF-2）**：所有 request-based 控制 op 须在 5s 内应答。未来若新增可能 >5s 的
    // 慢 op（如 spawn 前同步跑慢外部程序），须为其单独放宽超时，否则会被误取消 → 连接 desync。
    control.set_read_timeout(Some(std::time::Duration::from_secs(5)));

    let state = ConmuxState {
        control: Mutex::new(Some(control)),
        sessions: Mutex::new(HashMap::new()),
        next_pane_seq: AtomicU64::new(1),
    };

    // setup：启动时 create 初始 conmux-default 会话（powershell），保持 M② 行为。
    // M⑤b：默认会话无 args / cwd（&[] / None），与现状一致（不破默认会话 "conmux"）。
    spawn_session_into(app, &state, DEFAULT_PANE_ID, DEFAULT_PROGRAM, &[], None)
        .map_err(|e| format!("初始会话创建失败: {e}"))?;

    Ok(state)
}

/// 在给定 paneId 上 spawn + attach + 起读线程 + 存 SessionHandle（多会话核心，setup 与
/// create_session 共用）。控制连接已确证 daemon 在跑——attach 用 `Client::connect`（具名管道，
/// 省第二次 connect_or_spawn 的翻倍退避，D-4）；取名失败回退 connect_or_spawn。
///
/// M⑤b：增 `args` + `cwd` 形参，透传进 `CommandSpec`（兑现 `wsl -d Ubuntu`、
/// `claude --resume` 等带参 / 指定目录启动，D-4）。`args=&[]` / `cwd=None` 即现状行为。
///
/// 失败 ⇒ Err（调用方决定降级 / 返错）。成功 ⇒ SessionHandle 已入 state.sessions。

/// Slice 1：把 program 收敛为绝对路径。已是绝对路径 → 直接返回；裸名 → PATH×PATHEXT
/// 解析；未命中 → fail-closed Err（不把裸名透传给内核 spawn 守卫）。
/// setup/reconnect 传 `DEFAULT_PROGRAM`（裸名 powershell.exe）经此解析；create_session
/// 已解析传绝对路径，is_absolute 短路返回（不重复 PATH 查找）。
#[cfg(windows)]
fn resolve_program_absolute(program: &str) -> Result<String, String> {
    use std::path::Path;
    if Path::new(program).is_absolute() {
        return Ok(program.to_string());
    }
    crate::commands::resolve_on_path(program)
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| format!("无法解析命令到可执行文件: {program}"))
}

#[cfg(windows)]
pub(crate) fn spawn_session_into(
    app: &tauri::AppHandle,
    state: &ConmuxState,
    pane_id: &str,
    program: &str,
    args: &[String],
    cwd: Option<&str>,
) -> Result<SessionInfo, String> {
    use conmux::pane::{CommandSpec, SpawnRequest};
    use conmux::protocol::{MuxOp, MuxPayload};
    use conmux::types::{PaneId, PaneSize};

    let now_ms = now_millis();

    // Slice 1：到达内核 spawn 的 program 必为绝对路径（内核守卫 fail-closed）。
    let program = resolve_program_absolute(program)?;

    // finding-2：conmux 自起 powershell（无显式 args 时）注入 OSC7 prompt 包裹器，让 cwd 实时
    // 上报（aware-header B1 不再恒「—」）。用户给了显式 args 则尊重原样（不注入，避冲突）。
    let effective_args: Vec<String> = if args.is_empty() && is_powershell(&program) {
        powershell_osc7_args()
    } else {
        args.to_vec()
    };

    // Spawn（经长连控制连接）。pane_id == instanceId。
    {
        let mut guard = lock(&state.control);
        let control = guard
            .as_mut()
            .ok_or_else(|| "控制连接未就绪（daemon 客户端降级态）".to_string())?;
        let spawn = SpawnRequest {
            pane_id: PaneId(pane_id.to_string()),
            command: CommandSpec {
                program: program.clone(),
                args: effective_args,
                cwd: cwd.map(|c| c.to_string()),
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
            Err(conmux::ConmuxError::UntrustedProgram { program, reason }) => {
                // Slice 3：信任拒绝 → 结构化 JSON（前端 createSession 解析后弹 pin UI）。
                // program 是真正被拒目标（shim 或 exe，非 cmd.exe 包裹层）——内核 cmd-wrap
                // 加固后错误已指向 args 里的 shim 路径。pinnable=true：无签名 shim/exe 均可
                // 经 trust_pin_executable 自助信任后重试。
                let e = SpawnUntrustedError {
                    kind: "UntrustedProgram",
                    program,
                    reason,
                    pinnable: true,
                };
                return Err(serde_json::to_string(&e)
                    .unwrap_or_else(|_| "UntrustedProgram（序列化失败）".to_string()));
            }
            Err(e) => return Err(format!("Spawn 失败: {e}")),
        }
    }

    // attach 连接（D-4）：独立新连。优先 connect(具名管道)，取名失败回退 connect_or_spawn。
    let attach_client = match conmux::pipe::default_pipe_name() {
        Ok(name) => Client::connect(&name).map_err(|e| format!("attach 连接失败: {e}"))?,
        // 取管道名失败：回退 connect_or_spawn（功能正确，仅退避翻倍，D-4 兜底）。
        Err(_) => Client::connect_or_spawn().map_err(|e| format!("attach 连接失败: {e}"))?,
    };
    let attached = attach_client
        .attach(&PaneId(pane_id.to_string()))
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

    // into_split（R-1）：reader 入读线程，sender 入 SessionHandle（不共享同一 stream）。
    let (mut reader, sender) = attached.session.into_split();

    // 退出标志（D-5）用共享 Arc：读线程在 SessionHandle 入表之前即可置位，消除时序竞态。
    let exited = Arc::new(AtomicBool::new(false));
    let exited_for_thread = Arc::clone(&exited);

    let handle = SessionHandle {
        attach_sender: sender,
        exited,
        history_b64,
        adapter_id: ADAPTER_ID.to_string(),
    };

    // 读线程：recv_output 循环。live 帧（into_split 之后，不重不漏，R-4）→ base64 →
    // emit（instance_id=该 paneId）；Exited → 置该会话退出标志（D-5）+ emit ProcessExited。
    let app_for_thread = app.clone();
    let pane_for_thread = pane_id.to_string();
    let adapter_for_thread = ADAPTER_ID.to_string();
    std::thread::Builder::new()
        .name(format!("conmux-attach-reader:{pane_id}"))
        .spawn(move || {
            while let Some(ev) = reader.recv_output() {
                match ev {
                    AttachEvent::Output { seq, data } => {
                        emit_pty_output(&app_for_thread, &pane_for_thread, &data, seq);
                    }
                    AttachEvent::Exited { exit_code } => {
                        mark_and_emit_exit(
                            &app_for_thread,
                            &pane_for_thread,
                            &adapter_for_thread,
                            &exited_for_thread,
                            exit_code,
                        );
                        break;
                    }
                }
            }
            // recv_output 返 None（EOF / 背压断连，D-10）：登记退出态（兜底，避免前端永等）。
            // 若上方已因 Exited 置位，mark_and_emit_exit 幂等短路（不重复 emit）。
            mark_and_emit_exit(
                &app_for_thread,
                &pane_for_thread,
                &adapter_for_thread,
                &exited_for_thread,
                None,
            );
        })
        .map_err(|e| format!("读线程启动失败: {e}"))?;

    let info = SessionInfo {
        instance_id: pane_id.to_string(),
        adapter_id: handle.adapter_id.clone(),
        exited: false,
    };
    lock(&state.sessions).insert(pane_id.to_string(), handle);
    Ok(info)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// emit PaneOutput → conmux://pty-output（R-2：裸字节再 base64；R-9 fail-soft）。
#[cfg(windows)]
fn emit_pty_output(app: &tauri::AppHandle, pane_id: &str, data: &[u8], seq: u64) {
    let payload = serde_json::json!({
        "instance_id": pane_id,
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
fn mark_and_emit_exit(
    app: &tauri::AppHandle,
    pane_id: &str,
    adapter_id: &str,
    exited: &AtomicBool,
    exit_code: Option<i32>,
) {
    // swap → true：首次置位返回旧值 false（继续 emit）；已置位返回 true（幂等短路）。
    // 持共享 Arc 句柄、不依赖 app.try_state，故入表之前置位也不丢（红队 M2-MED）。
    if exited.swap(true, Ordering::SeqCst) {
        return;
    }
    let payload = serde_json::json!({
        "instance_id": pane_id,
        "adapter_id": adapter_id,
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
            commands::is_daemon_connected,
            commands::list_terminal_themes,
            commands::list_styles,
            commands::create_session,
            commands::list_sessions,
            commands::reconnect_daemon,
            commands::kill_session,
            commands::read_claude_jsonl,
            commands::list_available_skills,
            commands::trust_pin_executable,
            commands::trust_list,
            commands::trust_unpin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running conmux-app");
}

/// 装配 state：Windows 走 daemon 客户端路径（失败降级），其它平台直接降级。
#[cfg(windows)]
fn setup_state(app: &tauri::AppHandle) -> ConmuxState {
    match connect_and_setup(app) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_powershell_matches_by_basename_case_insensitive() {
        assert!(is_powershell("powershell.exe"));
        assert!(is_powershell("powershell"));
        assert!(is_powershell("POWERSHELL.EXE"));
        assert!(is_powershell("pwsh.exe"));
        assert!(is_powershell(
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        ));
        assert!(!is_powershell("wsl.exe"));
        assert!(!is_powershell("cmd.exe"));
        assert!(!is_powershell("claude"));
    }

    #[test]
    fn powershell_osc7_args_encode_decode_roundtrip() {
        let args = powershell_osc7_args();
        assert_eq!(args.len(), 3);
        assert_eq!(args[0], "-NoExit");
        assert_eq!(args[1], "-EncodedCommand");
        // base64(UTF-16LE) → 解回原 setup 脚本（PowerShell -EncodedCommand 同款编码）。
        let bytes = BASE64.decode(&args[2]).expect("base64 decodes");
        assert_eq!(bytes.len() % 2, 0, "UTF-16LE 必偶数字节");
        let u16s: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let decoded = String::from_utf16(&u16s).expect("valid UTF-16");
        assert_eq!(decoded, PS_OSC7_SETUP);
        // setup 含 OSC7 发射（]7;file://）+ prompt 包裹 + 原 prompt 保留（& $__op）+ 路径
        // 逐段 percent-encode（红队 SF：避 osc7.ts decode 端误解码）。
        assert!(decoded.contains("]7;file:///"));
        assert!(decoded.contains("function global:prompt"));
        assert!(decoded.contains("& $__op"));
        assert!(decoded.contains("EscapeDataString"));
    }
}
