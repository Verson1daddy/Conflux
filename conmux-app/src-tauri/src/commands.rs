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

/// 在 PATH × PATHEXT 上解析 program → 首个存在文件路径（finding-3）。含路径分隔符则直接判该路径。
#[cfg(windows)]
pub(crate) fn resolve_on_path(program: &str) -> Option<std::path::PathBuf> {
    use std::path::Path;
    if program.contains('\\') || program.contains('/') {
        let p = Path::new(program);
        return if p.is_file() { Some(p.to_path_buf()) } else { None };
    }
    let path_var = std::env::var_os("PATH")?;
    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    for dir in std::env::split_paths(&path_var) {
        let bare = dir.join(program); // 原名（可能已含 .exe，或无后缀 shim 脚本）。
        if bare.is_file() {
            return Some(bare);
        }
        for ext in pathext.split(';').filter(|s| !s.is_empty()) {
            let cand = dir.join(format!("{program}{ext}"));
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

/// 快捷启动 program 是否需 shell 包裹（finding-3）：解析到非 `.exe`（npm shim 的 .cmd /
/// 无后缀脚本等）→ CreateProcess 不能直接跑 → 需 `cmd /c` 让 shell 解析。
///
/// Slice 1：改为接收**已解析路径**（消除原内部二次 `resolve_on_path`）。调用方先解析、
/// 复用结果；未命中已在调用方 fail-closed，此处必为已解析到具体文件。
#[cfg(windows)]
fn needs_shell_wrap(resolved: &std::path::Path) -> bool {
    !resolved
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
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
        // Slice 1：解析一次、复用。未命中 → fail-closed（不把裸名透传给内核，消除"验的
        // 文件≠跑的文件"TOCTOU）。needs_shell_wrap 接收已解析路径，消除原二次 resolve。
        let resolved = resolve_on_path(&program)
            .ok_or_else(|| format!("无法解析命令到可执行文件: {program}"))?;
        let (program, args) = if needs_shell_wrap(&resolved) {
            // shell-wrap（resolved 是 .cmd/.bat/无扩展 shim）：program = 绝对 cmd.exe，
            // args = ["/c", 绝对 shim 路径, ...原 args]。cmd.exe 解析失败也 fail-closed。
            let cmd_abs = resolve_on_path("cmd")
                .ok_or_else(|| "无法解析 cmd.exe（系统 PATH 异常）".to_string())?;
            let mut wrapped = vec!["/c".to_string(), resolved.to_string_lossy().into_owned()];
            wrapped.extend(args);
            (cmd_abs.to_string_lossy().into_owned(), wrapped)
        } else {
            // 直起 exe：program = 绝对路径。
            (resolved.to_string_lossy().into_owned(), args)
        };
        crate::spawn_session_into(&app, &state, &pane_id, &program, &args, cwd.as_deref())
    }
    #[cfg(not(windows))]
    {
        let _ = (&state, program, args, cwd);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
    }
}

/// 收集当前会话快照（list_sessions / reconnect_daemon 共用）。稳定排序（HashMap 迭代序不定）：
/// default 优先，其余按 instanceId 升序——缩点条顺序确定、前端 active 顺延可预测。
#[cfg(windows)]
fn collect_sessions(state: &ConmuxState) -> Vec<SessionInfo> {
    let guard = lock(&state.sessions);
    let mut out: Vec<SessionInfo> = guard
        .iter()
        .map(|(id, h)| SessionInfo {
            instance_id: id.clone(),
            adapter_id: h.adapter_id.clone(),
            exited: h.exited.load(Ordering::SeqCst),
        })
        .collect();
    out.sort_by(|a, b| {
        let rank = |id: &str| if id == crate::DEFAULT_PANE_ID { 0 } else { 1 };
        rank(&a.instance_id)
            .cmp(&rank(&b.instance_id))
            .then_with(|| a.instance_id.cmp(&b.instance_id))
    });
    out
}

/// 列出当前所有会话（前端启动拉取构建缩点条）。返回 instanceId/adapterId/exited。
#[tauri::command]
pub async fn list_sessions(state: State<'_, ConmuxState>) -> Result<Vec<SessionInfo>, String> {
    #[cfg(windows)]
    {
        Ok(collect_sessions(&state))
    }
    #[cfg(not(windows))]
    {
        let _ = &state;
        Ok(Vec::new())
    }
}

/// daemon 自动重连（Part 2）：控制连接被探活丢弃（daemon 死/wedge）后自愈——重建控制连接、
/// 据 daemon 实际 pane 列表恢复会话，让控制面不需重启即可用。前端心跳探到掉线时调用。
///
/// 流程（Windows）：
/// - control 仍 Some（已连 / 别处已重连）→ 不动，幂等返当前会话（防抢占健康连接）。
/// - control None → `connect_or_spawn`（连存活 daemon 或拉起新）+ 设 5s 读超时 → `ListPanes`
///   探 daemon 真实 pane：
///     · **空**（fresh daemon——旧 pane 已随 daemon 死亡、attach 读线程已 emit Exited）→ 清本地
///       会话表 + 起 fresh 默认会话（恢复到可用态）。
///     · **非空**（survivor daemon）→ 不清不重起（旧 attach 连接各自管生命周期），仅恢复控制——
///       **绝不误清仍存活的会话**（5s 超时丢连接后 daemon 其实没死的边界）。
///     · 探测失败（罕见，刚连上）→ 保守按非空处理（宁可少恢复，不误清）。
/// 返回恢复后会话列表，前端据此 re-sync store + bump generation 强制终端重挂载（接新 pane 流）。
/// `reconnect_daemon` 应答：`respawned` = 是否真重起了新 pane（fresh daemon）。前端据此决定
/// 是否 bump generation 强制终端重挂载——**survivor（daemon 没死、会话仍活）不重挂载，保住
/// scrollback、不打断**（红队 SF-2）；仅 fresh daemon 重起才需重挂载接新 pane 流。
#[derive(serde::Serialize)]
pub struct ReconnectResult {
    pub respawned: bool,
    pub sessions: Vec<SessionInfo>,
}

#[tauri::command]
pub async fn reconnect_daemon(
    #[allow(unused_variables)] app: tauri::AppHandle,
    state: State<'_, ConmuxState>,
) -> Result<ReconnectResult, String> {
    #[cfg(windows)]
    {
        use conmux::client::Client;
        use conmux::protocol::{MuxOp, MuxPayload};

        // 已连接 → 幂等返回（防抢占健康连接），未重起。
        let connected = lock(&state.control).is_some();
        if connected {
            return Ok(ReconnectResult {
                respawned: false,
                sessions: collect_sessions(&state),
            });
        }

        // 重建控制连接（连存活 / 拉起新 daemon）+ 设读超时（同 connect_and_setup）。
        let mut control =
            Client::connect_or_spawn().map_err(|e| format!("重连 daemon 失败: {e}"))?;
        control.set_read_timeout(Some(std::time::Duration::from_secs(5)));

        // 探 daemon 真实 pane（在本地 control 上，未入 state，无持锁）。
        let pane_count = match control.request(MuxOp::ListPanes) {
            Ok(MuxPayload::Panes(p)) => p.len(),
            _ => usize::MAX, // 探测失败 → 保守按非空（不误清存活会话）。
        };

        // 装回控制连接。
        *lock(&state.control) = Some(control);

        // fresh daemon（无 pane）：旧会话已死 → 清表 + 起 fresh 默认会话。
        let respawned = pane_count == 0;
        if respawned {
            lock(&state.sessions).clear();
            if let Err(e) = crate::spawn_session_into(
                &app,
                &state,
                crate::DEFAULT_PANE_ID,
                crate::DEFAULT_PROGRAM,
                &[],
                None,
            ) {
                // SF-1 回滚：spawn 失败若留 control=Some，下次心跳见 alive 不再重连 → 卡死在
                // 零会话绿点态。丢弃控制 → 下一 tick 重入重连重试（不留半死态）。
                *lock(&state.control) = None;
                return Err(format!("重连后初始会话创建失败: {e}"));
            }
        }

        Ok(ReconnectResult {
            respawned,
            sessions: collect_sessions(&state),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (&app, &state);
        Err("conmux daemon 客户端仅支持 Windows".to_string())
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

/// daemon 控制连接是否**真活**（M⑤h 真信号 → 真心跳升级）：Windows 经长连控制连接发一次
/// 最廉价的只读 op（`ListThemes`，daemon serve 回路真处理、无副作用）做活性探测——**真往返
/// 成功**才 true。daemon 进程死亡 → 管道断 → `request` 返 Err → false，比旧 `control.is_some()`
/// 诚实（连接对象存在 ≠ daemon 还活着）。前端按心跳间隔轮询此命令，daemon 中途死亡可在 UI
/// 实时反映（点转灰）。降级态 / KillServer 后 control=None → false。非 Windows 恒 false
/// （无命名管道 / ConPTY）。永不抛（前端拉失败也按 false 降级）。
/// **超时治理**（红队 SF-1 已修）：控制连接已设 5s 读超时（lib.rs `connect_and_setup`），
/// wedged-but-alive daemon 下 `request` 最多阻塞 5s 即返 Err，不再无限持锁；探活失败即丢弃
/// 连接（下，避免超时半帧 desync 误用）。**自动重连 + pane 重拉为后续项（Part 2）**——当前丢弃
/// 后控制命令降级返「未就绪」直至重启/重连。
#[tauri::command]
pub async fn is_daemon_connected(state: State<'_, ConmuxState>) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use conmux::protocol::MuxOp;
        let mut guard = lock(&state.control);
        let alive = match guard.as_mut() {
            Some(control) => control.request(MuxOp::ListThemes).is_ok(),
            None => false,
        };
        // 探活失败（5s 读超时 / 管道断）→ 连接已死或可能 desync（超时后半帧残留），丢弃以免
        // 后续控制命令误读残帧。重连 + pane 重拉 = Part 2 后续；当前丢弃后控制命令降级返
        // 「未就绪」直至重启/重连，但不再无限阻塞、不再假亮（诚实降级）。
        if !alive {
            *guard = None;
        }
        Ok(alive)
    }
    #[cfg(not(windows))]
    {
        let _ = &state;
        Ok(false)
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

// ===== M⑥ 富观测：读 Claude Code 会话 JSONL + 枚举已安装 skills =====
//
// 纯本地读文件，不接任何 provider 凭据（授信前审门不触发，D-9）。两命令均**无 State 依赖**
// （M-2：cwd 由前端传入，不改 SessionHandle / ConmuxState / spawn）。降级语义优先：
// cwd 空 / 目录不存在 / 文件不存在 → 返回空结果，**不 Err、不 panic**（§4）。
// path-traversal 已规避：cwd 经 sanitize（非字母数字全替 `-`），不含 `..` / 分隔符（D-13）。

/// 用户主目录（home）：Windows `%USERPROFILE%`，其它平台 `$HOME`（§2.1）。拿不到 → None。
fn home_dir() -> Option<std::path::PathBuf> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(key).map(std::path::PathBuf::from)
}

/// cwd → project 目录名（§2.1）：每个非 `[A-Za-z0-9]` 字符替换为 `-`（不合并连续）。
/// e.g. `D:\Trae_rela_pro\Conflux` → `D--Trae-rela-pro-Conflux`。
fn sanitize_cwd(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// 选目录下 mtime 最新的 `.jsonl`，返回 (路径, mtime_ms)。无则 None。
fn newest_jsonl(dir: &std::path::Path) -> Option<(std::path::PathBuf, f64)> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut best: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let modified = match entry.metadata().and_then(|m| m.modified()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        match &best {
            Some((_, bm)) if *bm >= modified => {}
            _ => best = Some((path, modified)),
        }
    }
    let (path, mtime) = best?;
    let mtime_ms = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Some((path, mtime_ms))
}

/// 从 `offset` 字节读到 EOF，按 `\n` 切完整行（最后无换行结尾的半行不返回，offset 停在
/// 最后一个完整 `\n` 后，下次补读，§2.3）。返回 (完整行集, 新 offset)。
fn read_complete_lines(path: &std::path::Path, offset: u64) -> std::io::Result<(Vec<String>, u64)> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    // offset 超出文件长度（文件被截断 / 轮换）→ 从头读（容错）。
    let start = if offset > len { 0 } else { offset };
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    // 找最后一个 `\n`；其后的半行不返回（下次补读）。
    let last_nl = buf.iter().rposition(|&b| b == b'\n');
    let complete_end = match last_nl {
        Some(idx) => idx + 1, // 含换行符
        None => 0,            // 无完整行
    };
    let complete = &buf[..complete_end];
    let new_offset = start + complete_end as u64;
    // 按 `\n` 切；空尾段过滤。lossy UTF-8（半个多字节序列不抛）。
    let text = String::from_utf8_lossy(complete);
    let lines: Vec<String> = text
        .split('\n')
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    Ok((lines, new_offset))
}

/// session-id 形态校验（B2，2026-07-02 审计 S1）：只放行 hex + `-` 的 UUID 形态字符，
/// 拒绝一切路径语义字符（`/` `\` `.` 等）——id 会被拼进文件名，fail-closed 防逃逸。
fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// 取单个文件 mtime（ms since epoch）；拿不到 → None。
fn file_mtime_ms(path: &std::path::Path) -> Option<f64> {
    let m = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    Some(
        m.duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0),
    )
}

/// 轮换陈旧阈值（ms）：锚定文件超此时长无写入且目录存在严格更新的 jsonl
/// → 判定 claude 已内部轮换会话（/clear 等），降级跟随最新文件（F1）。
const JSONL_ROTATION_STALE_MS: f64 = 120_000.0;

fn rotation_stale(mtime_ms: f64) -> bool {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    now_ms - mtime_ms > JSONL_ROTATION_STALE_MS
}

/// 读 Claude Code 会话 JSONL 尾部增量（M⑥ §2/§4，**无 State**）。
/// §2.1 sanitize cwd → `<home>/.claude/projects/<sanitized>/` → 选目标 `.jsonl` →
/// 从 `offset` 读到 EOF（半行不返回）→ 返回 `{lines, offset, file, mtimeMs}` JSON 字符串。
///
/// 文件选择（B2，2026-07-02 审计 S1 串台修复）：
///   - `session_id` 有值且形态合法 → **精确锚定** `<session_id>.jsonl`；文件尚未出现
///     （claude 未写盘）→ 返回空**等待**，绝不回退 mtime（回退即重新引入串台）。
///   - `session_id` 形态非法 → 拒绝（返回空），不静默回退。
///   - `session_id` 无值（老会话 / 非注入启动）→ 沿用 mtime 最新（已知同 cwd 多活会话
///     有串台风险，注入路径已消除主场景）。
///
/// 降级语义优先（不 Err、不 panic）：cwd 空 / home 拿不到 / 目录不存在 / 无 jsonl /
/// 读失败 → 返回 `{"lines":[],"offset":0}`。坏行 / 半行不在此打日志（L-3，前端 parser try/catch）。
#[tauri::command]
pub async fn read_claude_jsonl(
    cwd: String,
    offset: u64,
    session_id: Option<String>,
) -> Result<String, String> {
    let empty = || r#"{"lines":[],"offset":0}"#.to_string();
    if cwd.trim().is_empty() {
        return Ok(empty());
    }
    let home = match home_dir() {
        Some(h) => h,
        None => return Ok(empty()),
    };
    let dir = home
        .join(".claude")
        .join("projects")
        .join(sanitize_cwd(&cwd));
    let target = match session_id.as_deref() {
        Some(id) if is_valid_session_id(id) => {
            let p = dir.join(format!("{id}.jsonl"));
            match file_mtime_ms(&p) {
                Some(mtime) if p.is_file() => {
                    // F1（红队 2026-07-02 MUST-FIX）：claude 内部会话轮换（/clear 等）
                    // 换写新 <newid>.jsonl，锚定文件从此静默但仍存在——恒锚定会把观测
                    // 冻死在旧会话（前端 file-change 复位链永不触发、权威标记压制 PTY
                    // 降级）。降级规则：锚定文件陈旧且目录存在**严格更新**的 jsonl →
                    // 跟随最新文件（前端 file-change 重置 offset/accum/权威标记）。
                    // 诚实残留：此窗口内同 cwd 另一活跃会话会被跟上（= B2 前旧行为），
                    // 属"锚点已死、无更好锚"的降级；UI 侧活跃度门照常兜底。
                    if rotation_stale(mtime) {
                        match newest_jsonl(&dir) {
                            Some((np, nm)) if nm > mtime => Some((np, nm)),
                            _ => Some((p, mtime)),
                        }
                    } else {
                        Some((p, mtime))
                    }
                }
                _ => None, // 目标会话文件尚未出现 → 诚实空等（不回退 mtime，防串台）。
            }
        }
        Some(_) => None, // 非法形态：fail-closed。
        None => newest_jsonl(&dir),
    };
    let (path, mtime_ms) = match target {
        Some(v) => v,
        None => return Ok(empty()),
    };
    let (lines, new_offset) = match read_complete_lines(&path, offset) {
        Ok(v) => v,
        Err(_) => return Ok(empty()),
    };
    let file = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    // serde_json::to_string 自动转义控制字符（NUL/ESC 在对话明文里 → \u00xx），输出无裸控制字符。
    let payload = serde_json::json!({
        "lines": lines,
        "offset": new_offset,
        "file": file,
        "mtimeMs": mtime_ms,
    });
    serde_json::to_string(&payload).map_err(|e| format!("序列化失败: {e}"))
}

/// 枚举用户级已安装 skills（M⑥ §4，**无 State**，v1 仅用户级、项目级推迟）。
/// `<home>/.claude/skills/*/SKILL.md` → 行级取 frontmatter `name`/`description`
/// （非完整 YAML）：`name` 取 `^name:\s*(.+)$` trim 去引号，**缺 name → 目录名兜底**；
/// `description` 同法、失败 → 空串（不阻断计数）。返回 `[{name,description}]` JSON。
/// 读失败 / 目录不存在 → 返回 `[]`。
#[tauri::command]
pub async fn list_available_skills() -> Result<String, String> {
    let empty = || "[]".to_string();
    let home = match home_dir() {
        Some(h) => h,
        None => return Ok(empty()),
    };
    let skills_dir = home.join(".claude").join("skills");
    let entries = match std::fs::read_dir(&skills_dir) {
        Ok(e) => e,
        Err(_) => return Ok(empty()),
    };
    let mut out: Vec<serde_json::Value> = Vec::new();
    for entry in entries.flatten() {
        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let skill_md = dir_path.join("SKILL.md");
        let dir_name = dir_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        // 跳过空目录名（不应发生，防御）。
        if dir_name.is_empty() {
            continue;
        }
        let content = std::fs::read_to_string(&skill_md).unwrap_or_default();
        let name = extract_frontmatter_field(&content, "name").unwrap_or(dir_name);
        let description = extract_frontmatter_field(&content, "description").unwrap_or_default();
        out.push(serde_json::json!({ "name": name, "description": description }));
    }
    // 稳定排序（read_dir 序不定）：按 name 升序，前端计数 / 列表确定。
    out.sort_by(|a, b| {
        let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        an.cmp(bn)
    });
    serde_json::to_string(&out).map_err(|e| format!("序列化失败: {e}"))
}

/// 行级取 frontmatter `<field>:` 首个匹配的值（trim + 去包裹引号）；无 → None。
/// 非完整 YAML 解析（S-4）：只扫顶层 `^<field>:\s*(.+)$` 形态。
fn extract_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let prefix = format!("{field}:");
    for line in content.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix(&prefix) {
            let val = rest.trim();
            if val.is_empty() {
                return None;
            }
            // 去包裹引号（单 / 双）。
            let unquoted = val
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .or_else(|| val.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
                .unwrap_or(val);
            return Some(unquoted.trim().to_string());
        }
    }
    None
}

// ===== Slice 2/3 信任库管理命令 =====
//
// conmux-app 经 daemon 客户端，spawn 实际在 daemon 进程内执行（信任校验也在 daemon）。
// **Slice 3 关键变化**：pin 现走 daemon `PinExecutable` IPC（同 SharedTrustStore Arc，
// 内存态即时生效 + 存盘），免重启 daemon。IPC 失败（daemon 不可达 / 旧版无此 op）回退
// 直写 `trust.toml`——下次 daemon 重启加载即见（向后兼容）。unpin/list 仍直读文件
// （daemon 未暴露 unpin IPC；list 是只读快照，无需即时）。

/// pin 一个可执行文件：算 SHA-256 + 写 pinned_targets + 存盘。
/// path 必须为绝对路径（与内核 spawn 守卫一致）。
///
/// Slice 3：优先走 daemon `PinExecutable` IPC（内存态即时生效，下次 spawn verify 即见）；
/// IPC 不可用（daemon 不可达 / 旧版）回退直写文件（下次 daemon 重启生效）。
#[tauri::command]
pub async fn trust_pin_executable(
    state: State<'_, ConmuxState>,
    path: String,
) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err(format!("path 必须为绝对路径: {path}"));
    }
    if !p.exists() {
        return Err(format!("文件不存在: {path}"));
    }
    // 优先 IPC（即时生效）。控制连接不可用 / daemon 旧版无此 op / 任何 IPC 错 → 回退直写。
    #[cfg(windows)]
    {
        use conmux::protocol::{MuxOp, MuxPayload};
        let ipc_ok = {
            let mut guard = lock(&state.control);
            match guard.as_mut() {
                Some(control) => match control.request(MuxOp::PinExecutable { path: path.clone() }) {
                    Ok(MuxPayload::Pinned) => true,
                    Ok(other) => {
                        // 不预期，但不算致命——回退直写并附诊断。
                        eprintln!("[trust_pin] IPC 应答非预期: {other:?}，回退直写");
                        false
                    }
                    Err(e) => {
                        eprintln!("[trust_pin] IPC 失败，回退直写: {e}");
                        false
                    }
                },
                None => false,
            }
        };
        if ipc_ok {
            return Ok(());
        }
    }
    // 回退：直写文件（向后兼容；下次 daemon 重启加载即见）。
    let mut store = conmux::TrustStore::load_or_create();
    store.pin_executable(&path)
}

/// 列出当前信任库快照（mode + trusted_publishers + pinned_targets）。
#[tauri::command]
pub async fn trust_list() -> Result<conmux::TrustStore, String> {
    Ok(conmux::TrustStore::load_or_create())
}

/// 移除 pin（存盘）。
#[tauri::command]
pub async fn trust_unpin(path: String) -> Result<(), String> {
    let mut store = conmux::TrustStore::load_or_create();
    store.unpin(&path)
}

// ===== WSL 启动 picker（列已装发行版，供 Home 选发行版 + CLI 生成命令）=====

/// 解析 `wsl --list --quiet` 的 **UTF-16LE** 输出为发行版名列表（纯函数，便于单测）。
/// wsl.exe 输出是 UTF-16LE（每 ASCII 字符夹一个 NUL，按 UTF-8 直读会得夹 NUL 乱码）；
/// 按 u16 小端解码后逐行 trim、去 BOM、去空行 / 残留 NUL / `\r`。
pub(crate) fn parse_wsl_list(bytes: &[u8]) -> Vec<String> {
    let start = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        2
    } else {
        0
    };
    let u16s: Vec<u16> = bytes[start..]
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&u16s)
        .lines()
        .map(|l| l.trim().trim_matches('\u{0}').trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// 列出已安装的 WSL 发行版（Home 的 WSL 启动 picker 用）。跑 `wsl.exe --list --quiet`
/// （UTF-16LE 输出，见 `parse_wsl_list`）。这是 std::process 探测调用、非 PTY 会话 spawn，
/// 不经验签闸。wsl 未安装 / 命令失败 → 返回**空 Vec**（前端据空降级到纯文本加项）。
#[tauri::command]
pub async fn list_wsl_distros() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // 不弹控制台窗口
        match std::process::Command::new("wsl.exe")
            .args(["--list", "--quiet"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(o) if o.status.success() => Ok(parse_wsl_list(&o.stdout)),
            _ => Ok(Vec::new()),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod session_id_tests {
    use super::is_valid_session_id;

    #[test]
    fn accepts_uuid_shape() {
        assert!(is_valid_session_id("87cd893d-b486-4728-a2b6-0fee08f4b31b"));
        assert!(is_valid_session_id("ABCDEF01-2345")); // hex 大小写 + '-' 宽松形态即可
    }

    #[test]
    fn rejects_path_semantics_fail_closed() {
        // id 拼进文件名——一切路径语义字符必须拒绝（B2 防逃逸）。
        assert!(!is_valid_session_id(""));
        assert!(!is_valid_session_id("../evil"));
        assert!(!is_valid_session_id("..\\evil"));
        assert!(!is_valid_session_id("a/b"));
        assert!(!is_valid_session_id("a.jsonl"));
        assert!(!is_valid_session_id("a".repeat(65).as_str())); // 超长（纯 hex 也拒）
        assert!(!is_valid_session_id("g123")); // 非 hex 字母
    }
}

#[cfg(test)]
mod wsl_tests {
    use super::parse_wsl_list;

    fn utf16le(s: &str) -> Vec<u8> {
        let mut b = Vec::new();
        for u in s.encode_utf16() {
            b.extend_from_slice(&u.to_le_bytes());
        }
        b
    }

    #[test]
    fn parse_wsl_list_decodes_utf16le_names() {
        let b = utf16le("Ubuntu\r\nUbuntu-22.04\r\n");
        assert_eq!(
            parse_wsl_list(&b),
            vec!["Ubuntu".to_string(), "Ubuntu-22.04".to_string()]
        );
    }

    #[test]
    fn parse_wsl_list_empty_input() {
        assert!(parse_wsl_list(&[]).is_empty());
    }

    #[test]
    fn parse_wsl_list_strips_bom_and_blank_lines() {
        let mut b = vec![0xFFu8, 0xFE];
        b.extend_from_slice(&utf16le("Debian\r\n\r\nkali-linux\r\n"));
        assert_eq!(
            parse_wsl_list(&b),
            vec!["Debian".to_string(), "kali-linux".to_string()]
        );
    }
}
