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
fn resolve_on_path(program: &str) -> Option<std::path::PathBuf> {
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
/// 无后缀脚本等）→ CreateProcess 不能直接跑 → 需 `cmd /c` 让 shell 解析。`.exe` / 显式
/// .exe 后缀 / 未解析 → 直起（不动 wsl.exe/powershell.exe 等真 exe 的 M⑤b 直起行为）。
#[cfg(windows)]
fn needs_shell_wrap(program: &str) -> bool {
    if program.to_ascii_lowercase().ends_with(".exe") {
        return false;
    }
    match resolve_on_path(program) {
        Some(p) => !p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false),
        None => false, // 未解析 → 不包裹（让自然失败，不掩盖拼写错）。
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
        // finding-3：claude 等 npm shim（.cmd/无后缀脚本）不能被 CreateProcess 直接 spawn
        // （快捷启动 "claude" → 0 PANES）。解析到非 .exe → 包 `cmd /c` 让 shell 解析 shim；
        // wsl.exe/powershell.exe 等真 exe 仍直起（不动 M⑤b 直起行为）。
        let (program, args) = if needs_shell_wrap(&program) {
            let mut wrapped = vec!["/c".to_string(), program];
            wrapped.extend(args);
            ("cmd".to_string(), wrapped)
        } else {
            (program, args)
        };
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

/// daemon 控制连接是否**真活**（M⑤h 真信号 → 真心跳升级）：Windows 经长连控制连接发一次
/// 最廉价的只读 op（`ListThemes`，daemon serve 回路真处理、无副作用）做活性探测——**真往返
/// 成功**才 true。daemon 进程死亡 → 管道断 → `request` 返 Err → false，比旧 `control.is_some()`
/// 诚实（连接对象存在 ≠ daemon 还活着）。前端按心跳间隔轮询此命令，daemon 中途死亡可在 UI
/// 实时反映（点转灰）。降级态 / KillServer 后 control=None → false。非 Windows 恒 false
/// （无命名管道 / ConPTY）。永不抛（前端拉失败也按 false 降级）。
/// **已知局限**（与所有控制 op 同源）：`request` 阻塞读无超时，wedged-but-alive daemon 会阻塞
/// 持锁——但主导失败态是进程死亡（管道断 → 干净 Err）；读超时 + 自动重连 + pane 重拉为后续项。
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

/// 读 Claude Code 会话 JSONL 尾部增量（M⑥ §2/§4，**无 State**）。
/// §2.1 sanitize cwd → `<home>/.claude/projects/<sanitized>/` → 选最新 `.jsonl` →
/// 从 `offset` 读到 EOF（半行不返回）→ 返回 `{lines, offset, file, mtimeMs}` JSON 字符串。
///
/// 降级语义优先（不 Err、不 panic）：cwd 空 / home 拿不到 / 目录不存在 / 无 jsonl /
/// 读失败 → 返回 `{"lines":[],"offset":0}`。坏行 / 半行不在此打日志（L-3，前端 parser try/catch）。
#[tauri::command]
pub async fn read_claude_jsonl(cwd: String, offset: u64) -> Result<String, String> {
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
    let (path, mtime_ms) = match newest_jsonl(&dir) {
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
