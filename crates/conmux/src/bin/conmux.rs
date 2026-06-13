//! conmux CLI（M2 设计 D-2，单二进制多子命令）。
//!
//! `conmux daemon` 前台跑 daemon；其余子命令为瘦客户端（连接当前用户 daemon，无则自动拉起）。
//! M2a 子命令：daemon / new / ls / send / capture / kill / resize / respawn / kill-server。
//! attach / detach（交互流）归 M2b。
//!
//! 命令语义见契约增补 §2.2（自有命令语义，非 tmux 方言；用户裁决 D3）。

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(run(&args));
}

#[cfg(not(windows))]
fn run(_args: &[String]) -> i32 {
    eprintln!("conmux daemon/客户端仅支持 Windows（命名管道 + ConPTY）。");
    1
}

#[cfg(windows)]
fn run(args: &[String]) -> i32 {
    use cmds::*;
    match args.first().map(String::as_str) {
        Some("daemon") => cmd_daemon(),
        Some("new") => cmd_new(&args[1..]),
        Some("ls") => cmd_ls(&args[1..]),
        Some("send") => cmd_send(&args[1..]),
        Some("capture") => cmd_capture(&args[1..]),
        Some("kill") => cmd_kill(&args[1..]),
        Some("resize") => cmd_resize(&args[1..]),
        Some("respawn") => cmd_respawn(&args[1..]),
        Some("kill-server") => cmd_kill_server(),
        Some("-h") | Some("--help") | Some("help") | None => {
            usage();
            0
        }
        Some(other) => {
            eprintln!("未知命令: {other}\n");
            usage();
            2
        }
    }
}

#[cfg(windows)]
fn usage() {
    eprintln!(
        "conmux —— Windows 原生终端多路复用器\n\
\n\
用法:\n\
  conmux daemon                          前台运行 daemon\n\
  conmux new [-s NAME] [-d DIR] [--size RxC] [-- CMD...]   新建 pane（缺省 shell=powershell）\n\
  conmux ls [--json]                     列出 pane\n\
  conmux send -t PANE [--literal] TEXT   注入字节到 pane stdin\n\
  conmux capture -t PANE [--ansi] [--last-bytes N | --lines A:B]   捕获 scrollback\n\
  conmux kill -t PANE                    整树终结 pane\n\
  conmux resize -t PANE -x COLS -y ROWS  调整 pane 尺寸\n\
  conmux respawn -t PANE [-d DIR] [--size RxC] [-- CMD...]  同 ID 重起\n\
  conmux kill-server                     终结 daemon 及全部会话\n\
\n\
其余子命令（连接当前用户 daemon，不存在则自动拉起）。attach/detach 见后续里程碑。"
    );
}

#[cfg(windows)]
mod cmds {
    use conmux::capture::{CaptureRange, CaptureRequest};
    use conmux::client::Client;
    use conmux::daemon::{Daemon, DaemonConfig};
    use conmux::pane::{CommandSpec, SpawnRequest};
    use conmux::protocol::{MuxOp, MuxPayload};
    use conmux::types::{PaneId, PaneSize};
    use conmux::ConmuxError;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// `conmux daemon`：前台运行（阻塞至 KillServer）。
    pub fn cmd_daemon() -> i32 {
        let config = match DaemonConfig::for_current_user() {
            Ok(c) => c,
            Err(e) => return fail(&format!("派生管道名失败: {e}")),
        };
        match Daemon::bind(config) {
            Ok(daemon) => {
                eprintln!("conmux daemon 已启动，监听中…");
                daemon.serve();
                eprintln!("conmux daemon 已退出。");
                0
            }
            // bind 失败 = 已有 daemon / 被抢注（I-2，不降级）。
            Err(e) => fail(&format!("daemon 绑定失败（可能已在运行）: {e}")),
        }
    }

    /// `conmux new`：spawn 一个 pane。CLI 作为「调用方」生成稳定 pane_id（conmux 库不生成 ID）。
    pub fn cmd_new(args: &[String]) -> i32 {
        let mut name: Option<String> = None;
        let mut dir: Option<String> = None;
        let mut size = PaneSize { rows: 30, cols: 120 };
        let mut cmd: Vec<String> = Vec::new();
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "-s" => name = it.next().cloned(),
                "-d" => dir = it.next().cloned(),
                "--size" => match it.next().and_then(|s| parse_size(s)) {
                    Some(s) => size = s,
                    None => return fail("--size 需形如 RxC，如 30x120"),
                },
                "--" => {
                    cmd = it.by_ref().cloned().collect();
                    break;
                }
                other => return fail(&format!("new: 未知参数 {other}")),
            }
        }
        let (program, cmd_args) = split_command(cmd);
        let pane_id = generate_pane_id();
        let req = SpawnRequest {
            pane_id: PaneId(pane_id.clone()),
            command: CommandSpec {
                program,
                args: cmd_args,
                cwd: dir,
                env: Vec::new(),
            },
            size,
            adapter_id: "shell".into(),
            display_name: name,
            created_at: unix_millis(),
        };
        with_client(|c| match c.request(MuxOp::Spawn(req))? {
            MuxPayload::Spawned(id) => {
                println!("{}", id.0);
                Ok(())
            }
            other => Err(unexpected(other)),
        })
    }

    /// `conmux ls [--json]`。
    pub fn cmd_ls(args: &[String]) -> i32 {
        let json = args.iter().any(|a| a == "--json");
        with_client(|c| match c.request(MuxOp::ListPanes)? {
            MuxPayload::Panes(panes) => {
                if json {
                    let s = serde_json::to_string_pretty(&panes)
                        .map_err(|e| ConmuxError::SerializationError { message: e.to_string() })?;
                    println!("{s}");
                } else if panes.is_empty() {
                    println!("(无 pane)");
                } else {
                    println!("{:<28} {:<8} {:<10} {}", "PANE_ID", "PID", "LIFECYCLE", "NAME");
                    for p in &panes {
                        println!(
                            "{:<28} {:<8} {:<10} {}",
                            p.pane_id.0,
                            p.pid.map(|n| n.to_string()).unwrap_or_else(|| "-".into()),
                            format!("{:?}", p.lifecycle),
                            p.display_name.clone().unwrap_or_default()
                        );
                    }
                }
                Ok(())
            }
            other => Err(unexpected(other)),
        })
    }

    /// `conmux send -t PANE [--literal] TEXT...`。缺省在文本尾补 `\r`（回车提交），`--literal` 不补。
    pub fn cmd_send(args: &[String]) -> i32 {
        let mut target: Option<String> = None;
        let mut literal = false;
        let mut text_parts: Vec<String> = Vec::new();
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "-t" => target = it.next().cloned(),
                "--literal" => literal = true,
                "--" => {
                    text_parts = it.by_ref().cloned().collect();
                    break;
                }
                other => text_parts.push(other.to_string()),
            }
        }
        let Some(pane) = target else {
            return fail("send 需 -t PANE");
        };
        let mut data = text_parts.join(" ");
        if !literal {
            data.push('\r');
        }
        with_client(|c| match c.request(MuxOp::Send { pane_id: PaneId(pane.clone()), data: data.clone() })? {
            MuxPayload::Sent => Ok(()),
            other => Err(unexpected(other)),
        })
    }

    /// `conmux capture -t PANE [--ansi] [--last-bytes N | --lines A:B]`。
    pub fn cmd_capture(args: &[String]) -> i32 {
        let mut target: Option<String> = None;
        let mut ansi = false;
        let mut range = CaptureRange::All;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "-t" => target = it.next().cloned(),
                "--ansi" => ansi = true,
                "--last-bytes" => match it.next().and_then(|s| s.parse::<usize>().ok()) {
                    Some(n) => range = CaptureRange::LastBytes(n),
                    None => return fail("--last-bytes 需正整数"),
                },
                "--lines" => match it.next().and_then(|s| parse_line_range(s)) {
                    Some(r) => range = r,
                    None => return fail("--lines 需形如 A:B（绝对行号）"),
                },
                other => return fail(&format!("capture: 未知参数 {other}")),
            }
        }
        let Some(pane) = target else {
            return fail("capture 需 -t PANE");
        };
        with_client(|c| match c.request(MuxOp::Capture(CaptureRequest {
            pane_id: PaneId(pane.clone()),
            range: range.clone(),
            ansi,
        }))? {
            MuxPayload::Captured(res) => {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(res.data_base64.as_bytes())
                    .map_err(|e| ConmuxError::SerializationError { message: e.to_string() })?;
                use std::io::Write;
                std::io::stdout().write_all(&bytes).ok();
                if res.truncated {
                    eprintln!("\n[capture: 部分范围已被环覆盖，截断]");
                }
                Ok(())
            }
            other => Err(unexpected(other)),
        })
    }

    /// `conmux kill -t PANE`。
    pub fn cmd_kill(args: &[String]) -> i32 {
        let Some(pane) = flag_value(args, "-t") else {
            return fail("kill 需 -t PANE");
        };
        with_client(|c| match c.request(MuxOp::KillTree { pane_id: PaneId(pane.clone()) })? {
            MuxPayload::Killed => Ok(()),
            other => Err(unexpected(other)),
        })
    }

    /// `conmux resize -t PANE -x COLS -y ROWS`。
    pub fn cmd_resize(args: &[String]) -> i32 {
        let target = flag_value(args, "-t");
        let cols = flag_value(args, "-x").and_then(|s| s.parse::<u16>().ok());
        let rows = flag_value(args, "-y").and_then(|s| s.parse::<u16>().ok());
        let (Some(pane), Some(cols), Some(rows)) = (target, cols, rows) else {
            return fail("resize 需 -t PANE -x COLS -y ROWS");
        };
        with_client(|c| match c.request(MuxOp::Resize {
            pane_id: PaneId(pane.clone()),
            size: PaneSize { rows, cols },
        })? {
            MuxPayload::Resized => Ok(()),
            other => Err(unexpected(other)),
        })
    }

    /// `conmux respawn -t PANE [-d DIR] [--size RxC] [-- CMD...]`：同 ID 重起。
    pub fn cmd_respawn(args: &[String]) -> i32 {
        let mut target: Option<String> = None;
        let mut dir: Option<String> = None;
        let mut size = PaneSize { rows: 30, cols: 120 };
        let mut cmd: Vec<String> = Vec::new();
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "-t" => target = it.next().cloned(),
                "-d" => dir = it.next().cloned(),
                "--size" => match it.next().and_then(|s| parse_size(s)) {
                    Some(s) => size = s,
                    None => return fail("--size 需形如 RxC"),
                },
                "--" => {
                    cmd = it.by_ref().cloned().collect();
                    break;
                }
                other => return fail(&format!("respawn: 未知参数 {other}")),
            }
        }
        let Some(pane) = target else {
            return fail("respawn 需 -t PANE");
        };
        let (program, cmd_args) = split_command(cmd);
        let req = SpawnRequest {
            pane_id: PaneId(pane.clone()),
            command: CommandSpec {
                program,
                args: cmd_args,
                cwd: dir,
                env: Vec::new(),
            },
            size,
            adapter_id: "shell".into(),
            display_name: None,
            created_at: unix_millis(),
        };
        with_client(|c| match c.request(MuxOp::Respawn(req))? {
            MuxPayload::Spawned(id) => {
                println!("{}", id.0);
                Ok(())
            }
            other => Err(unexpected(other)),
        })
    }

    /// `conmux kill-server`：终结 daemon 及全部会话。
    pub fn cmd_kill_server() -> i32 {
        with_client(|c| match c.request(MuxOp::KillServer)? {
            MuxPayload::ServerKillScheduled => {
                eprintln!("daemon 终结已排程。");
                Ok(())
            }
            other => Err(unexpected(other)),
        })
    }

    // ===== 助手 =====

    /// 连接 daemon（自动拉起）→ 跑闭包 → 统一错误展示与退出码。
    fn with_client(f: impl FnOnce(&mut Client) -> Result<(), ConmuxError>) -> i32 {
        let mut client = match Client::connect_or_spawn() {
            Ok(c) => c,
            Err(e) => return fail(&format!("连接 daemon 失败: {e}")),
        };
        match f(&mut client) {
            Ok(()) => 0,
            Err(e) => fail(&e.to_string()),
        }
    }

    fn fail(msg: &str) -> i32 {
        eprintln!("conmux: {msg}");
        1
    }

    fn unexpected(p: MuxPayload) -> ConmuxError {
        ConmuxError::PtyError {
            message: format!("daemon 返回非预期应答: {p:?}"),
        }
    }

    /// 取 `--flag VALUE` 形式的值。
    fn flag_value(args: &[String], flag: &str) -> Option<String> {
        args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
    }

    /// "RxC" → PaneSize{rows:R, cols:C}。
    fn parse_size(s: &str) -> Option<PaneSize> {
        let (r, c) = s.split_once(['x', 'X'])?;
        Some(PaneSize {
            rows: r.trim().parse().ok()?,
            cols: c.trim().parse().ok()?,
        })
    }

    /// "A:B" → LineRange{start_abs:A, end_abs:B}。
    fn parse_line_range(s: &str) -> Option<CaptureRange> {
        let (a, b) = s.split_once(':')?;
        Some(CaptureRange::LineRange {
            start_abs: a.trim().parse().ok()?,
            end_abs: b.trim().parse().ok()?,
        })
    }

    /// CMD vec → (program, args)；空 ⇒ 默认 shell（powershell）。
    fn split_command(cmd: Vec<String>) -> (String, Vec<String>) {
        if cmd.is_empty() {
            ("powershell.exe".to_string(), Vec::new())
        } else {
            let mut it = cmd.into_iter();
            let program = it.next().unwrap();
            (program, it.collect())
        }
    }

    /// 稳定 pane_id（CLI 作为调用方生成；进程 id + 纳秒，免引 uuid）。
    fn generate_pane_id() -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("pane-{}-{}", std::process::id(), nanos)
    }

    fn unix_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }
}
