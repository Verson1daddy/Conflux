//! M2a daemon IPC 集成测试：真实命名管道 + daemon 线程 + 客户端，端到端请求-应答 +
//! 安全不变量逐条（错误版本 / 首帧非 Hello / 真实身份握手）。仅 Windows。
//!
//! 这些测试跑真实 ConPTY pane（spawn cmd → capture 输出 → kill），是 M2a 验收的
//! 「管道层集成测试」（设计 §M2a 里程碑）。身份不可得（I-5）路径无法用真实同用户
//! 管道触发，已在 daemon.rs 单测以注入 identity=None 覆盖。

#![cfg(windows)]

use std::time::{Duration, Instant};

use conmux::client::Client;
use conmux::daemon::{Daemon, DaemonConfig, ShutdownHandle};
use conmux::pane::{CommandSpec, SpawnRequest};
use conmux::pipe::{try_connect, ConnectOutcome};
use conmux::protocol::{MuxOp, MuxPayload, MuxRequest, WireFrame, PROTOCOL_VERSION};
use conmux::types::{PaneId, PaneSize};
use conmux::wire::{read_frame, write_frame, WireError};

/// 启动 daemon：主线程 bind（创建首实例 = 管道立即可连），后台线程 serve。
fn start_daemon(name: &str) -> ShutdownHandle {
    let daemon = Daemon::bind(DaemonConfig {
        pipe_name: name.to_string(),
    })
    .expect("daemon bind 应成功");
    let handle = daemon.shutdown_handle();
    std::thread::spawn(move || daemon.serve());
    handle
}

/// 重试连接（等 serve 线程进入 accept；bind 后管道已存在，通常首次即成）。
fn connect_retry(name: &str) -> Client {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match Client::connect(name) {
            Ok(c) => return c,
            Err(_) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(e) => panic!("连接 daemon 超时: {e}"),
        }
    }
}

fn spawn_req(pane_id: &str, program: &str, args: &[&str]) -> SpawnRequest {
    SpawnRequest {
        pane_id: PaneId(pane_id.into()),
        command: CommandSpec {
            program: program.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: None,
            env: Vec::new(),
        },
        size: PaneSize { rows: 30, cols: 120 },
        adapter_id: "shell".into(),
        display_name: Some("itest".into()),
        created_at: 1_700_000_000_000,
    }
}

fn capture_text(client: &mut Client, pane: &str) -> String {
    match client
        .request(MuxOp::Capture(conmux::capture::CaptureRequest {
            pane_id: PaneId(pane.into()),
            range: conmux::capture::CaptureRange::All,
            ansi: false,
        }))
        .expect("capture 应成功")
    {
        MuxPayload::Captured(res) => {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(res.data_base64.as_bytes())
                .unwrap();
            String::from_utf8_lossy(&bytes).into_owned()
        }
        other => panic!("capture 应回 Captured，实际 {other:?}"),
    }
}

/// 端到端：连接 → ls 空 → spawn 真实 cmd pane → ls 1 → capture 含 marker → kill → ls 空。
#[test]
fn end_to_end_spawn_capture_kill_over_real_pipe() {
    let name = r"\\.\pipe\conmux-itest-e2e";
    let sh = start_daemon(name);
    let mut client = connect_retry(name);

    // ls 空。
    assert!(matches!(
        client.request(MuxOp::ListPanes).unwrap(),
        MuxPayload::Panes(ref p) if p.is_empty()
    ));

    // spawn 真实 pane：cmd /k 跑后存活（echo marker 后留在提示符）。
    let pane = "itest-pane-1";
    let req = spawn_req(pane, "cmd.exe", &["/k", "echo CONMUX_E2E_MARKER"]);
    match client.request(MuxOp::Spawn(req)).unwrap() {
        MuxPayload::Spawned(id) => assert_eq!(id.0, pane),
        other => panic!("spawn 应回 Spawned，实际 {other:?}"),
    }

    // ls 1。
    match client.request(MuxOp::ListPanes).unwrap() {
        MuxPayload::Panes(p) => {
            assert_eq!(p.len(), 1);
            assert_eq!(p[0].pane_id.0, pane);
            assert!(p[0].pid.is_some(), "真实进程应有 pid");
        }
        other => panic!("ls 应回 Panes，实际 {other:?}"),
    }

    // capture 轮询至含 marker（ConPTY 输出异步喂 scrollback）。
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut got_marker = false;
    while Instant::now() < deadline {
        if capture_text(&mut client, pane).contains("CONMUX_E2E_MARKER") {
            got_marker = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(got_marker, "capture 应捕获到 pane 输出的 marker");

    // kill → ls 空（MF-4 整树终结，pane 移除）。
    assert!(matches!(
        client.request(MuxOp::KillTree { pane_id: PaneId(pane.into()) }).unwrap(),
        MuxPayload::Killed
    ));
    match client.request(MuxOp::ListPanes).unwrap() {
        MuxPayload::Panes(p) => assert!(p.is_empty(), "kill 后应无 pane"),
        other => panic!("{other:?}"),
    }

    sh.shutdown();
}

/// send 注入到真实 pane：写一行命令，capture 应回显（唯一写链 UserDirect，R-1/R-2）。
#[test]
fn send_injects_into_real_pane() {
    let name = r"\\.\pipe\conmux-itest-send";
    let sh = start_daemon(name);
    let mut client = connect_retry(name);

    let pane = "itest-send-1";
    client
        .request(MuxOp::Spawn(spawn_req(pane, "cmd.exe", &["/k", "prompt $G"])))
        .unwrap();
    // 注入一行 echo（\r 提交）。
    match client
        .request(MuxOp::Send {
            pane_id: PaneId(pane.into()),
            data: "echo CONMUX_INJECTED_42\r".into(),
        })
        .unwrap()
    {
        MuxPayload::Sent => {}
        other => panic!("send 应回 Sent，实际 {other:?}"),
    }

    let deadline = Instant::now() + Duration::from_secs(8);
    let mut echoed = false;
    while Instant::now() < deadline {
        if capture_text(&mut client, pane).contains("CONMUX_INJECTED_42") {
            echoed = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(echoed, "注入的命令应在 pane 输出中回显（唯一写链到达 ConPTY）");

    client
        .request(MuxOp::KillTree { pane_id: PaneId(pane.into()) })
        .unwrap();
    sh.shutdown();
}

/// 安全：错误协议版本握手 ⇒ daemon 断连，不回 HelloAck（真实管道）。
#[test]
fn wrong_version_handshake_is_disconnected() {
    let name = r"\\.\pipe\conmux-itest-badver";
    let sh = start_daemon(name);

    let mut stream = raw_connect(name);
    write_frame(
        &mut stream,
        &WireFrame::Hello {
            protocol_version: PROTOCOL_VERSION + 7,
            client_kind: "attacker".into(),
        },
    )
    .expect("写 Hello");
    // daemon 应拒绝并断连：下一读为 EOF（无 HelloAck）。
    match read_frame(&mut stream) {
        Err(WireError::Eof) => {}
        Err(WireError::Io(_)) => {} // 断连也可能表现为 Io 错误
        other => panic!("版本不匹配应断连（无 HelloAck），实际: {other:?}"),
    }
    sh.shutdown();
}

/// 安全：首帧非 Hello（直接发 Request）⇒ daemon 断连（H-2）。
#[test]
fn non_hello_first_frame_is_disconnected() {
    let name = r"\\.\pipe\conmux-itest-nohello";
    let sh = start_daemon(name);

    let mut stream = raw_connect(name);
    write_frame(
        &mut stream,
        &WireFrame::Request(MuxRequest {
            correlation_id: 1,
            op: MuxOp::ListPanes,
        }),
    )
    .expect("写 Request");
    match read_frame(&mut stream) {
        Err(WireError::Eof) | Err(WireError::Io(_)) => {}
        other => panic!("首帧非 Hello 应断连，实际: {other:?}"),
    }
    sh.shutdown();
}

/// kill-server：KillServer 回 ack 后 daemon 退出（后续连接 ⇒ 无 daemon）。
#[test]
fn kill_server_stops_daemon() {
    let name = r"\\.\pipe\conmux-itest-killsrv";
    let _sh = start_daemon(name);
    let mut client = connect_retry(name);

    assert!(matches!(
        client.request(MuxOp::KillServer).unwrap(),
        MuxPayload::ServerKillScheduled
    ));
    drop(client);

    // daemon 关闭后，新连接最终 ⇒ NoDaemon（给关闭一点时间）。
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match try_connect(name, 100).expect("try_connect") {
            ConnectOutcome::NoDaemon => break,
            ConnectOutcome::Connected(_) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(100))
            }
            ConnectOutcome::Connected(_) => panic!("kill-server 后 daemon 仍在监听"),
        }
    }
}

/// 原始连接（绕过 Client 握手，供安全测试构造对抗帧）。
fn raw_connect(name: &str) -> conmux::pipe::PipeStream {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match try_connect(name, 200).expect("try_connect") {
            ConnectOutcome::Connected(s) => return s,
            ConnectOutcome::NoDaemon if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20))
            }
            ConnectOutcome::NoDaemon => panic!("daemon 未就绪"),
        }
    }
}
