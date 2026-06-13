//! conmux daemon 服务端（M2 设计 D-2/D-3/D-4，仅 Windows）。
//!
//! tmux server 模型（I-4）：单 daemon 持全部 ConPTY pane；CLI/GUI/第三方是瘦客户端。
//! 每客户端连接一线程（D-7 风险登记裁决：v1 用 std 线程，单用户客户端数 ≤ 个位数）。
//!
//! ## 安全不变量落实位
//! - **I-2 抢注守卫**：[`Daemon::bind`] 经 `PipeListener::bind`（FIRST_PIPE_INSTANCE），失败即报错退出。
//! - **I-5 身份 fail-closed**：[`handle_connection`] 取不到客户端 pid ⇒ 立即断连，不匿名放行。
//! - **D-4 握手 + H-2 方向约束**：[`serve_connection`] 首帧必须 Hello 且版本严格相等；
//!   握手后只接受 `Request`；任何方向违例 ⇒ 断连（无 HelloAck / 无应答）。
//! - **R-1 唯一写链跨 IPC**：[`dispatch`] 对 `Send` 唯一实现 = `PaneHost::inject_stdin`。
//! - **R-2 IPC 注入一律 UserDirect**：dispatcher 硬编码 `InjectionSource::UserDirect`，
//!   wire 无 source 协商面（MF-2 + 类型上无字段）。
//! - **H-3 panic 隔离**：每连接处理以 `catch_unwind` 包裹，单连接对抗输入只断该连接。
//!
//! M2a 范围：请求-应答全实现；事件 fan-out（Subscribe/Attach）与主题广播（SetTheme）
//! 留 M2b/M2c，dispatcher 对其返回 [`ConmuxError::Unsupported`]（类型已冻结，wire 不 churn）。

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::event::{MuxNotify, PaneEventSink};
use crate::pane::PaneHost;
use crate::pipe::{process_image_path, try_connect, ConnectOutcome, PipeListener, PipeStream};
use crate::protocol::{
    MuxOp, MuxPayload, MuxReply, MuxRequest, WireFrame, PROTOCOL_VERSION,
};
use crate::types::InjectionSource;
use crate::wire::{read_frame, write_frame, WireError};
use crate::ConmuxError;

/// daemon 版本（HelloAck 回报，仅审计/诊断，不参与授权）。
const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

/// daemon 装配配置。
pub struct DaemonConfig {
    /// 监听管道名。生产取 `pipe::default_pipe_name()`；测试用隔离名。
    pub pipe_name: String,
}

impl DaemonConfig {
    /// 当前用户的默认管道名（`\\.\pipe\conmux.<SID>`）。
    pub fn for_current_user() -> Result<Self, ConmuxError> {
        Ok(Self {
            pipe_name: crate::pipe::default_pipe_name()?,
        })
    }
}

/// 跨连接共享态：PaneHost（全部 pane 的属主）+ 运行标志 + 管道名（self-connect 唤醒用）。
struct DaemonShared {
    host: PaneHost,
    running: AtomicBool,
    pipe_name: String,
}

/// 事件出口占位（M2a）：fan-out 到订阅者归 M2b，本 sink 丢弃事件。
/// scrollback 由读线程在 sink 之前喂入，故 `capture` 仍可读到历史（请求-应答可用）。
struct NoopSink;
impl PaneEventSink for NoopSink {
    fn on_notify(&self, _notify: MuxNotify) {}
}

/// conmux daemon。`bind` 绑定管道（抢注守卫），`serve` 进入服务循环。
pub struct Daemon {
    shared: Arc<DaemonShared>,
    listener: PipeListener,
}

impl Daemon {
    /// 绑定管道并装配 PaneHost。`bind` 失败 ⇒ 已有 daemon / 被抢注（I-2，不降级）。
    pub fn bind(config: DaemonConfig) -> Result<Self, ConmuxError> {
        let listener = PipeListener::bind(&config.pipe_name)?;
        // M2a 单用形态：钩子链为空（R-2 全 UserDirect，无策略钩子）；event_sink = NoopSink。
        let host = PaneHost::new_windows(Vec::new(), Arc::new(NoopSink));
        let shared = Arc::new(DaemonShared {
            host,
            running: AtomicBool::new(true),
            pipe_name: config.pipe_name,
        });
        Ok(Self { shared, listener })
    }

    /// 取关闭句柄（测试 / 外部触发用）。KillServer 经连接内部触发，无需此句柄。
    pub fn shutdown_handle(&self) -> ShutdownHandle {
        ShutdownHandle {
            shared: Arc::clone(&self.shared),
        }
    }

    /// 服务循环：accept → 每连接一线程。阻塞至 shutdown（KillServer / 句柄触发）。
    pub fn serve(mut self) {
        while self.shared.running.load(Ordering::SeqCst) {
            match self.listener.accept() {
                Ok(stream) => {
                    if !self.shared.running.load(Ordering::SeqCst) {
                        break; // shutdown 期间的 self-connect 唤醒帧，丢弃
                    }
                    let shared = Arc::clone(&self.shared);
                    std::thread::spawn(move || {
                        // H-3 panic 隔离：单连接的对抗输入/bug panic 只断该连接。
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            handle_connection(stream, shared);
                        }));
                    });
                }
                Err(_e) => {
                    if !self.shared.running.load(Ordering::SeqCst) {
                        break;
                    }
                    // accept 偶发失败：短暂退避后继续（不让单次失败打死服务循环）。
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
    }
}

/// 关闭句柄：触发 daemon 退出 + 整树终结全部 pane。
pub struct ShutdownHandle {
    shared: Arc<DaemonShared>,
}

impl ShutdownHandle {
    /// 触发关闭：set running=false → kill 全部 pane → self-connect 唤醒阻塞的 accept。
    pub fn shutdown(&self) {
        trigger_shutdown(&self.shared);
    }
}

/// 关闭：标志位 → kill 全部 pane → self-connect 唤醒阻塞在 ConnectNamedPipe 的 accept。
fn trigger_shutdown(shared: &Arc<DaemonShared>) {
    shared.running.store(false, Ordering::SeqCst);
    kill_all_panes(&shared.host);
    // 唤醒阻塞的 accept：连上即弃。serve 循环 accept 返回后查 running=false → break。
    if let Ok(ConnectOutcome::Connected(s)) = try_connect(&shared.pipe_name, 200) {
        drop(s);
    }
}

/// 整树终结全部 pane（KillServer / 关闭；KILL_ON_JOB_CLOSE 兜底，但显式 kill 更确定）。
fn kill_all_panes(host: &PaneHost) {
    for state in host.list_panes() {
        let _ = host.kill(&state.pane_id);
    }
}

/// 单连接处理（真实管道）：取身份（I-5 fail-closed）→ serve_connection → KillServer 后触发关闭。
fn handle_connection(mut stream: PipeStream, shared: Arc<DaemonShared>) {
    // I-5：身份不可得 ⇒ 不匿名放行（serve_connection 收 None 即 RejectedNoIdentity）。
    let identity = stream.client_process_id();
    // 连接级审计取数（RT-2：{pid, image_path}）。M2a 取数验证可得性；落盘归 M2c daemon 日志。
    if let Some(pid) = identity {
        let _image = process_image_path(pid);
    }
    let outcome = serve_connection(&mut stream, identity, &shared.host);
    if outcome == ConnOutcome::KillServerRequested {
        trigger_shutdown(&shared);
    }
}

/// 连接处理结果（安全/协议不变量的可观测出口，供单元测试断言）。
#[derive(Debug, PartialEq, Eq)]
enum ConnOutcome {
    /// I-5：客户端身份不可得 ⇒ 拒连（无 HelloAck）。
    RejectedNoIdentity,
    /// D-4：握手版本不匹配 ⇒ 断连（无 HelloAck）。
    RejectedBadVersion,
    /// H-2：首帧非 Hello ⇒ 断连。
    RejectedBadFirstFrame,
    /// H-2：握手后收到非 Request 方向帧 ⇒ 断连。
    RejectedBadDirection,
    /// 客户端正常断开（帧边界 EOF）。
    Closed,
    /// 收到 KillServer 请求（已回 ack）。
    KillServerRequested,
    /// I/O 错误断连。
    IoError,
}

/// 协议/安全核心（与传输解耦，操作任意 Read+Write + 注入的客户端身份）——
/// 使握手/方向/fail-closed 不变量可在内存 duplex 上单测，无需真实管道。
fn serve_connection<S: Read + Write>(
    stream: &mut S,
    identity: Option<u32>,
    host: &PaneHost,
) -> ConnOutcome {
    // I-5 fail-closed：身份不可得即拒，不进握手。
    if identity.is_none() {
        return ConnOutcome::RejectedNoIdentity;
    }

    // D-4 握手：首帧必须 Hello（仅握手期合法）+ 版本严格相等。
    match read_frame(stream) {
        Ok(WireFrame::Hello {
            protocol_version, ..
        }) => {
            if protocol_version != PROTOCOL_VERSION {
                return ConnOutcome::RejectedBadVersion; // 不回 HelloAck
            }
            let ack = WireFrame::HelloAck {
                protocol_version: PROTOCOL_VERSION,
                daemon_version: DAEMON_VERSION.into(),
            };
            if write_frame(stream, &ack).is_err() {
                return ConnOutcome::IoError;
            }
        }
        Ok(_) => return ConnOutcome::RejectedBadFirstFrame, // H-2：首帧非 Hello
        Err(WireError::Eof) => return ConnOutcome::Closed,
        Err(_) => return ConnOutcome::IoError,
    }

    // 请求循环：H-2 只接受 Request。
    loop {
        match read_frame(stream) {
            Ok(WireFrame::Request(req)) => {
                let kill_server = matches!(req.op, MuxOp::KillServer);
                let reply = dispatch(host, req);
                if write_frame(stream, &WireFrame::Reply(reply)).is_err() {
                    return ConnOutcome::IoError;
                }
                if kill_server {
                    return ConnOutcome::KillServerRequested;
                }
            }
            Ok(_) => return ConnOutcome::RejectedBadDirection, // H-2：方向违例
            Err(WireError::Eof) => return ConnOutcome::Closed,
            Err(_) => return ConnOutcome::IoError,
        }
    }
}

/// 请求分发（经 PaneHost，R-1）。`MuxOp` 穷尽 match——未来加变体在此编译报错强制裁决。
fn dispatch(host: &PaneHost, req: MuxRequest) -> MuxReply {
    let cid = req.correlation_id;
    let result: Result<MuxPayload, ConmuxError> = match req.op {
        MuxOp::Spawn(r) => host.spawn(r).map(MuxPayload::Spawned),
        MuxOp::Respawn(r) => {
            let pane_id = r.pane_id.clone();
            host.respawn(&pane_id, r).map(|_| MuxPayload::Spawned(pane_id))
        }
        // R-1 / R-2：IPC 注入唯一写链 = inject_stdin；source 硬编码 UserDirect（wire 无协商）。
        MuxOp::Send { pane_id, data } => host
            .inject_stdin(&pane_id, data.as_bytes(), InjectionSource::UserDirect)
            .map(|_| MuxPayload::Sent),
        MuxOp::Capture(r) => host.capture(r).map(MuxPayload::Captured),
        MuxOp::Resize { pane_id, size } => {
            host.resize(&pane_id, size).map(|_| MuxPayload::Resized)
        }
        MuxOp::KillTree { pane_id } => host.kill(&pane_id).map(|_| MuxPayload::Killed),
        MuxOp::ListPanes => Ok(MuxPayload::Panes(host.list_panes())),
        MuxOp::ListThemes => Ok(MuxPayload::Themes(crate::theme::builtin_terminal_themes())),
        MuxOp::KillServer => Ok(MuxPayload::ServerKillScheduled),
        // M2b：事件 fan-out + 无缝快照（需 seq 入 scrollback 锁域）。类型已冻结、行为留 M2b。
        MuxOp::Subscribe { .. } | MuxOp::Unsubscribe { .. } | MuxOp::Attach { .. } => {
            Err(ConmuxError::Unsupported {
                message: "Subscribe/Unsubscribe/Attach 在 M2b 落地（事件流/无缝快照）".into(),
            })
        }
        // M2c：主题热切换需向订阅者广播 ThemeChanged（依赖 M2b fan-out）。
        MuxOp::SetTheme { .. } => Err(ConmuxError::Unsupported {
            message: "SetTheme 在 M2c 落地（主题广播）".into(),
        }),
    };
    match result {
        Ok(payload) => MuxReply::Ok {
            correlation_id: cid,
            payload,
        },
        Err(error) => MuxReply::Err {
            correlation_id: cid,
            error,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::MuxRequest;
    use std::io::Cursor;

    /// 内存 duplex：读侧预载客户端帧（Cursor），写侧收集 daemon 回帧（Vec）。
    /// serve_connection 顺序读 Cursor 直到 EOF，回帧进 out——无需真实管道即可断言协议/安全不变量。
    struct DuplexMock {
        reader: Cursor<Vec<u8>>,
        out: Vec<u8>,
    }
    impl DuplexMock {
        fn with_frames(frames: &[WireFrame]) -> Self {
            let mut buf = Vec::new();
            for f in frames {
                write_frame(&mut buf, f).unwrap();
            }
            Self {
                reader: Cursor::new(buf),
                out: Vec::new(),
            }
        }
        /// 解析写侧收集到的回帧序列。
        fn replies(&self) -> Vec<WireFrame> {
            let mut cur = Cursor::new(self.out.clone());
            let mut v = Vec::new();
            while let Ok(f) = read_frame(&mut cur) {
                v.push(f);
            }
            v
        }
    }
    impl Read for DuplexMock {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.reader.read(buf)
        }
    }
    impl Write for DuplexMock {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.out.write(buf)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn empty_host() -> PaneHost {
        PaneHost::new_windows(Vec::new(), Arc::new(NoopSink))
    }

    fn hello(v: u32) -> WireFrame {
        WireFrame::Hello {
            protocol_version: v,
            client_kind: "test".into(),
        }
    }
    fn request(op: MuxOp) -> WireFrame {
        WireFrame::Request(MuxRequest {
            correlation_id: 1,
            op,
        })
    }

    /// I-5：客户端身份不可得 ⇒ RejectedNoIdentity，不写任何回帧（无 HelloAck）。
    #[test]
    fn no_identity_is_rejected_before_handshake() {
        let mut mock = DuplexMock::with_frames(&[hello(PROTOCOL_VERSION)]);
        let outcome = serve_connection(&mut mock, None, &empty_host());
        assert_eq!(outcome, ConnOutcome::RejectedNoIdentity);
        assert!(mock.out.is_empty(), "拒连不应写 HelloAck");
    }

    /// D-4：握手版本不匹配 ⇒ RejectedBadVersion，无 HelloAck。
    #[test]
    fn wrong_protocol_version_is_rejected() {
        let mut mock = DuplexMock::with_frames(&[hello(PROTOCOL_VERSION + 99)]);
        let outcome = serve_connection(&mut mock, Some(1234), &empty_host());
        assert_eq!(outcome, ConnOutcome::RejectedBadVersion);
        assert!(mock.replies().is_empty(), "版本不匹配不应回 HelloAck");
    }

    /// H-2：首帧非 Hello（直接发 Request）⇒ RejectedBadFirstFrame。
    #[test]
    fn non_hello_first_frame_is_rejected() {
        let mut mock = DuplexMock::with_frames(&[request(MuxOp::ListPanes)]);
        let outcome = serve_connection(&mut mock, Some(1234), &empty_host());
        assert_eq!(outcome, ConnOutcome::RejectedBadFirstFrame);
        assert!(mock.replies().is_empty());
    }

    /// 握手后收到非 Request 方向帧（Notify）⇒ RejectedBadDirection（H-2）。
    #[test]
    fn wrong_direction_after_handshake_is_rejected() {
        let notify = WireFrame::Notify(MuxNotify::PaneExited {
            pane_id: crate::types::PaneId("x".into()),
            exit_code: None,
        });
        let mut mock = DuplexMock::with_frames(&[hello(PROTOCOL_VERSION), notify]);
        let outcome = serve_connection(&mut mock, Some(1234), &empty_host());
        assert_eq!(outcome, ConnOutcome::RejectedBadDirection);
        // 握手成功了（回了 HelloAck），但随后方向违例断连。
        let replies = mock.replies();
        assert_eq!(replies.len(), 1);
        assert!(matches!(replies[0], WireFrame::HelloAck { .. }));
    }

    /// happy path：Hello + ListPanes + EOF ⇒ HelloAck + Reply(Panes 空) + Closed。
    #[test]
    fn handshake_then_listpanes_replies_ok() {
        let mut mock =
            DuplexMock::with_frames(&[hello(PROTOCOL_VERSION), request(MuxOp::ListPanes)]);
        let outcome = serve_connection(&mut mock, Some(1234), &empty_host());
        assert_eq!(outcome, ConnOutcome::Closed);
        let replies = mock.replies();
        assert_eq!(replies.len(), 2);
        assert!(matches!(replies[0], WireFrame::HelloAck { .. }));
        match &replies[1] {
            WireFrame::Reply(MuxReply::Ok {
                payload: MuxPayload::Panes(p),
                ..
            }) => assert!(p.is_empty()),
            other => panic!("应为 Ok(Panes)，实际: {other:?}"),
        }
    }

    /// KillServer ⇒ 回 ServerKillScheduled + 返回 KillServerRequested。
    #[test]
    fn kill_server_acks_then_signals() {
        let mut mock =
            DuplexMock::with_frames(&[hello(PROTOCOL_VERSION), request(MuxOp::KillServer)]);
        let outcome = serve_connection(&mut mock, Some(1234), &empty_host());
        assert_eq!(outcome, ConnOutcome::KillServerRequested);
        let replies = mock.replies();
        assert!(matches!(
            replies.last(),
            Some(WireFrame::Reply(MuxReply::Ok {
                payload: MuxPayload::ServerKillScheduled,
                ..
            }))
        ));
    }

    /// M2b 留：Subscribe/Attach 返回 Unsupported（类型已冻结，行为分阶段）。
    #[test]
    fn subscribe_and_attach_are_unsupported_in_m2a() {
        for op in [
            MuxOp::Subscribe {
                pane_id: crate::types::PaneId("p".into()),
            },
            MuxOp::Attach {
                pane_id: crate::types::PaneId("p".into()),
            },
            MuxOp::SetTheme { id: "b-dark-ink".into() },
        ] {
            let mut mock = DuplexMock::with_frames(&[hello(PROTOCOL_VERSION), request(op)]);
            serve_connection(&mut mock, Some(1234), &empty_host());
            let replies = mock.replies();
            assert!(
                matches!(
                    replies.last(),
                    Some(WireFrame::Reply(MuxReply::Err {
                        error: ConmuxError::Unsupported { .. },
                        ..
                    }))
                ),
                "M2a 应回 Unsupported，实际: {:?}",
                replies.last()
            );
        }
    }

    /// ListThemes 在 M2a 即可用（返回内置预置，无需 fan-out）。
    #[test]
    fn list_themes_works_in_m2a() {
        let mut mock =
            DuplexMock::with_frames(&[hello(PROTOCOL_VERSION), request(MuxOp::ListThemes)]);
        serve_connection(&mut mock, Some(1234), &empty_host());
        let replies = mock.replies();
        match replies.last() {
            Some(WireFrame::Reply(MuxReply::Ok {
                payload: MuxPayload::Themes(themes),
                ..
            })) => assert!(!themes.is_empty()),
            other => panic!("应为 Ok(Themes)，实际: {other:?}"),
        }
    }
}
