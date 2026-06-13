//! conmux daemon 服务端（M2 设计 D-2..D-7，仅 Windows）。
//!
//! tmux server 模型（I-4）：单 daemon 持全部 ConPTY pane；CLI/GUI/第三方是瘦客户端。
//! **每连接 reader + writer 双线程**（D-7）：reader 阻塞 ReadFile 收请求/stdin；writer 从
//! 有界外发队列取帧 WriteFile（回复 + 订阅事件）。事件 fan-out 非阻塞投递——任何慢客户端
//! 不传导到 PTY 读路径（D-7）。
//!
//! ## 安全/正确性不变量落实位
//! - **I-2 抢注守卫**：[`Daemon::bind`] 经 `PipeListener::bind`（FIRST_PIPE_INSTANCE），失败即退出。
//! - **I-5 身份 fail-closed**：[`handle_connection`] 取不到客户端 pid ⇒ 立即断连。
//! - **D-4 握手 + H-2 方向约束**：[`serve_connection`] 首帧必须 Hello + 版本严格相等；握手后只收 Request。
//! - **R-1 唯一写链跨 IPC / R-2 IPC 注入一律 UserDirect**：[`build_reply`] 对 Send 唯一实现 = `inject_stdin(UserDirect)`。
//! - **D-5 订阅模型**：Subscribe/Unsubscribe/Attach 维护每连接订阅集；[`FanoutSink`] 只向订阅者投递。
//! - **D-6 attach 无缝拼接**：Attach = 先注册订阅、后取 `attach_snapshot`（原子 history+last_seq）；
//!   base64/JSON 在锁外（PaneHost 已保证 H-1 锁纪律）。
//! - **D-7 背压**：每连接外发队列字节上界（8 MiB），超限断连该连接（读泵零损失）。
//! - **H-3 panic 隔离**：每连接 reader 以 `catch_unwind` 包裹；PaneHost 锁中毒容忍（M2a-M1）。

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use crate::event::{MuxNotify, PaneEventSink};
use crate::pane::PaneHost;
use crate::pipe::{process_image_path, try_connect, ConnectOutcome, PipeListener, PipeStream, PipeWriter};
use crate::protocol::{MuxOp, MuxPayload, MuxReply, MuxRequest, WireFrame, PROTOCOL_VERSION};
use crate::types::{InjectionSource, PaneId};
use crate::wire::{read_frame, write_frame, WireError};
use crate::ConmuxError;

/// daemon 版本（HelloAck 回报，仅审计/诊断，不参与授权）。
const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 每连接外发队列字节上界（D-7）。超限 ⇒ 断连该连接（客户端重连经 attach 快照恢复，零损失）。
const MAX_QUEUE_BYTES: usize = 8 * 1024 * 1024;

/// per-连接 attach 最小间隔（D-7 限速）：防快照放大 DoS（~100B Attach → 1.4MB 快照帧）。
const ATTACH_MIN_INTERVAL: Duration = Duration::from_millis(500);

/// 中毒容忍锁恢复（H-3，与 pane.rs::recover 同策略）——连接线程 panic 不级联成全域锁风暴。
fn recover<T>(e: PoisonError<MutexGuard<'_, T>>) -> MutexGuard<'_, T> {
    e.into_inner()
}

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

// ===== 外发队列 / 连接句柄 =====

/// 投递给 writer 线程的外发项。
enum Outbound {
    /// 一帧（含近似字节数，用于背压记账）。
    Frame(WireFrame, usize),
    /// 主动断连信号（背压超限 / 连接清理）——writer 收到即退出。
    Disconnect,
}

/// 连接句柄：外发队列 sender + 背压记账 + 订阅集。reader 线程、writer 线程、FanoutSink 共享。
struct ConnHandle {
    tx: Sender<Outbound>,
    /// 当前排队待发字节数（背压锚）。
    queued_bytes: AtomicUsize,
    /// 背压触发后置 true：fanout 跳过、reader 不再入队（writer 已收 Disconnect 退出）。
    dead: AtomicBool,
    /// 本连接订阅的 pane 集（D-5）。
    subscriptions: Mutex<HashSet<PaneId>>,
    /// 上次 attach 时刻（D-7 限速：<500ms 回 Busy，防快照放大 DoS）。
    last_attach_at: Mutex<Option<Instant>>,
}

impl ConnHandle {
    /// 入队一帧（背压感知，非阻塞）。超 8 MiB ⇒ 置 dead + 发 Disconnect（D-7）。
    fn enqueue(&self, frame: WireFrame, bytes: usize) {
        if self.dead.load(Ordering::Relaxed) {
            return;
        }
        if self.queued_bytes.load(Ordering::Relaxed).saturating_add(bytes) > MAX_QUEUE_BYTES {
            self.dead.store(true, Ordering::Relaxed);
            let _ = self.tx.send(Outbound::Disconnect);
            return;
        }
        self.queued_bytes.fetch_add(bytes, Ordering::Relaxed);
        if self.tx.send(Outbound::Frame(frame, bytes)).is_err() {
            // writer 已退出（连接断）——回滚记账。
            self.queued_bytes.fetch_sub(bytes, Ordering::Relaxed);
        }
    }

    fn is_subscribed(&self, pane_id: &PaneId) -> bool {
        self.subscriptions.lock().unwrap_or_else(recover).contains(pane_id)
    }
}

/// 事件出口：把 per-pane 事件 fan-out 给订阅该 pane 的连接（D-5）。
/// **非阻塞**（D-7）：on_notify 由 PaneHost 读泵调用，只做短锁 + 非阻塞 try_send，
/// 慢客户端的背压断连不回传到读路径。
struct FanoutSink {
    conns: Arc<Mutex<HashMap<u64, Arc<ConnHandle>>>>,
}

impl PaneEventSink for FanoutSink {
    fn on_notify(&self, notify: MuxNotify) {
        let pane_id = match &notify {
            MuxNotify::PaneOutput { pane_id, .. } | MuxNotify::PaneExited { pane_id, .. } => {
                pane_id.clone()
            }
            // ThemeChanged 广播 = M2c（依赖 SetTheme 落地）。
            _ => return,
        };
        let bytes = notify_bytes(&notify);
        let conns = self.conns.lock().unwrap_or_else(recover);
        for conn in conns.values() {
            if conn.is_subscribed(&pane_id) {
                conn.enqueue(WireFrame::Notify(notify.clone()), bytes);
            }
        }
    }
}

/// 跨连接共享态：PaneHost（全部 pane 的属主）+ 运行标志 + 管道名 + 连接注册表。
struct DaemonShared {
    host: PaneHost,
    running: AtomicBool,
    pipe_name: String,
    conns: Arc<Mutex<HashMap<u64, Arc<ConnHandle>>>>,
    next_conn_id: AtomicU64,
    /// 正在取快照的 pane 集（D-7：per-pane 并发快照=1，进行中再 Attach 回 Busy，防放大）。
    attaching: Mutex<HashSet<PaneId>>,
}

/// conmux daemon。`bind` 绑定管道，`serve` 进入服务循环。
pub struct Daemon {
    shared: Arc<DaemonShared>,
    listener: PipeListener,
}

impl Daemon {
    /// 绑定管道并装配 PaneHost（事件出口 = FanoutSink）。`bind` 失败 ⇒ 已有 daemon / 被抢注（I-2）。
    pub fn bind(config: DaemonConfig) -> Result<Self, ConmuxError> {
        let listener = PipeListener::bind(&config.pipe_name)?;
        let conns: Arc<Mutex<HashMap<u64, Arc<ConnHandle>>>> = Arc::new(Mutex::new(HashMap::new()));
        // M2a 单用形态：钩子链空（R-2 全 UserDirect）；event_sink = FanoutSink（按订阅投递）。
        let host = PaneHost::new_windows(
            Vec::new(),
            Arc::new(FanoutSink {
                conns: Arc::clone(&conns),
            }),
        );
        let shared = Arc::new(DaemonShared {
            host,
            running: AtomicBool::new(true),
            pipe_name: config.pipe_name,
            conns,
            next_conn_id: AtomicU64::new(1),
            attaching: Mutex::new(HashSet::new()),
        });
        Ok(Self { shared, listener })
    }

    /// 取关闭句柄（测试 / 外部触发用）。KillServer 经连接内部触发，无需此句柄。
    pub fn shutdown_handle(&self) -> ShutdownHandle {
        ShutdownHandle {
            shared: Arc::clone(&self.shared),
        }
    }

    /// 服务循环：accept → 每连接 reader 线程（reader 内再起 writer 线程）。阻塞至 shutdown。
    pub fn serve(mut self) {
        while self.shared.running.load(Ordering::SeqCst) {
            match self.listener.accept() {
                Ok(stream) => {
                    if !self.shared.running.load(Ordering::SeqCst) {
                        break; // shutdown 期间的 self-connect 唤醒帧，丢弃
                    }
                    let shared = Arc::clone(&self.shared);
                    std::thread::spawn(move || {
                        // H-3：单连接 panic（含其 writer 线程外）不传导 daemon 主体。
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            handle_connection(stream, shared);
                        }));
                    });
                }
                Err(_e) => {
                    if !self.shared.running.load(Ordering::SeqCst) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
    }
}

/// 关闭句柄：触发 daemon 退出 + 整树终结全部 pane + 断开全部连接。
pub struct ShutdownHandle {
    shared: Arc<DaemonShared>,
}

impl ShutdownHandle {
    pub fn shutdown(&self) {
        trigger_shutdown(&self.shared);
    }
}

/// 关闭：标志位 → kill 全部 pane → 断开全部连接（writer 退出）→ self-connect 唤醒 accept。
fn trigger_shutdown(shared: &Arc<DaemonShared>) {
    shared.running.store(false, Ordering::SeqCst);
    kill_all_panes(&shared.host);
    // 断开全部连接（writer 收 Disconnect 退出；reader 阻塞者待进程退出，见 D-7 v1 说明）。
    for conn in shared.conns.lock().unwrap_or_else(recover).values() {
        let _ = conn.tx.send(Outbound::Disconnect);
    }
    // 唤醒阻塞的 accept：连上即弃。serve 循环 accept 返回后查 running=false → break。
    if let Ok(ConnectOutcome::Connected(s)) = try_connect(&shared.pipe_name, 200) {
        drop(s);
    }
}

fn kill_all_panes(host: &PaneHost) {
    for state in host.list_panes() {
        let _ = host.kill(&state.pane_id);
    }
}

/// 单连接处理：取身份（I-5）→ split 读写半 → 起 writer 线程 → reader 循环 → 清理。
fn handle_connection(stream: PipeStream, shared: Arc<DaemonShared>) {
    // I-5：身份不可得 ⇒ 拒（serve_connection 收 None 即 RejectedNoIdentity）。
    let identity = stream.client_process_id();
    if let Some(pid) = identity {
        let _image = process_image_path(pid); // 连接级审计取数（RT-2，落盘 M2c）
    }
    let (mut reader, writer) = match stream.split() {
        Ok(halves) => halves,
        Err(_) => return, // 事件创建失败（极罕见资源耗尽）——放弃该连接
    };

    let (tx, rx) = channel::<Outbound>();
    let conn = Arc::new(ConnHandle {
        tx,
        queued_bytes: AtomicUsize::new(0),
        dead: AtomicBool::new(false),
        subscriptions: Mutex::new(HashSet::new()),
        last_attach_at: Mutex::new(None),
    });
    let conn_id = shared.next_conn_id.fetch_add(1, Ordering::SeqCst);
    shared
        .conns
        .lock()
        .unwrap_or_else(recover)
        .insert(conn_id, Arc::clone(&conn));

    // writer 线程：drain 外发队列。
    let writer_conn = Arc::clone(&conn);
    let writer_thread = std::thread::spawn(move || writer_loop(writer, rx, writer_conn));

    // reader 循环（本线程）。
    let outcome = serve_connection(&mut reader, identity, &shared, &conn);

    // 清理：摘连接 + 通知 writer 退出 + join。
    shared.conns.lock().unwrap_or_else(recover).remove(&conn_id);
    let _ = conn.tx.send(Outbound::Disconnect);
    let _ = writer_thread.join();

    if outcome == ConnOutcome::KillServerRequested {
        trigger_shutdown(&shared);
    }
}

/// writer 线程主体：从队列取帧 WriteFile；Disconnect 或写失败即退出。
fn writer_loop(mut writer: PipeWriter, rx: Receiver<Outbound>, conn: Arc<ConnHandle>) {
    while let Ok(item) = rx.recv() {
        match item {
            Outbound::Frame(frame, bytes) => {
                conn.queued_bytes.fetch_sub(bytes, Ordering::Relaxed);
                if write_frame(&mut writer, &frame).is_err() {
                    break; // 客户端断开
                }
            }
            Outbound::Disconnect => break,
        }
    }
}

/// 连接处理结果（安全/协议不变量的可观测出口，供单元测试断言）。
#[derive(Debug, PartialEq, Eq)]
enum ConnOutcome {
    RejectedNoIdentity,
    RejectedBadVersion,
    RejectedBadFirstFrame,
    RejectedBadDirection,
    Closed,
    KillServerRequested,
    IoError,
}

/// 协议/安全核心（reader 侧）：读帧 → 握手 → 请求循环，回复经 `conn.enqueue` 入外发队列。
/// 与传输解耦（泛型 `Read`）使握手/方向/fail-closed 不变量可在内存 Cursor 上单测。
fn serve_connection<R: Read>(
    reader: &mut R,
    identity: Option<u32>,
    shared: &Arc<DaemonShared>,
    conn: &ConnHandle,
) -> ConnOutcome {
    // I-5 fail-closed：身份不可得即拒，不进握手。
    if identity.is_none() {
        return ConnOutcome::RejectedNoIdentity;
    }

    // D-4 握手：首帧必须 Hello（仅握手期合法）+ 版本严格相等。
    match read_frame(reader) {
        Ok(WireFrame::Hello {
            protocol_version, ..
        }) => {
            if protocol_version != PROTOCOL_VERSION {
                return ConnOutcome::RejectedBadVersion; // 不回 HelloAck
            }
            conn.enqueue(
                WireFrame::HelloAck {
                    protocol_version: PROTOCOL_VERSION,
                    daemon_version: DAEMON_VERSION.into(),
                },
                128,
            );
        }
        Ok(_) => return ConnOutcome::RejectedBadFirstFrame, // H-2：首帧非 Hello
        Err(WireError::Eof) => return ConnOutcome::Closed,
        Err(_) => return ConnOutcome::IoError,
    }

    // 请求循环：H-2 只接受 Request。
    loop {
        match read_frame(reader) {
            Ok(WireFrame::Request(req)) => {
                let kill_server = matches!(req.op, MuxOp::KillServer);
                let reply = build_reply(req, shared, conn);
                conn.enqueue(WireFrame::Reply(reply), 256);
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

/// 构建应答（经 PaneHost，R-1）。`MuxOp` 穷尽 match——未来加变体在此编译报错强制裁决。
fn build_reply(req: MuxRequest, shared: &Arc<DaemonShared>, conn: &ConnHandle) -> MuxReply {
    let cid = req.correlation_id;
    let host = &shared.host;
    let running = &shared.running;
    let result: Result<MuxPayload, ConmuxError> = match req.op {
        // M2a-M3：关闭中拒绝新建/重起——否则 sweep 后到的 Spawn 拿成功应答却被 Job drop 瞬死。
        MuxOp::Spawn(_) | MuxOp::Respawn(_) if !running.load(Ordering::SeqCst) => {
            Err(ConmuxError::SupervisorError {
                message: "daemon 正在关闭，拒绝新建/重起 pane".into(),
            })
        }
        MuxOp::Spawn(r) => host.spawn(r).map(MuxPayload::Spawned),
        MuxOp::Respawn(r) => {
            let pane_id = r.pane_id.clone();
            host.respawn(&pane_id, r).map(|_| MuxPayload::Spawned(pane_id))
        }
        // R-1 / R-2：IPC 注入唯一写链 = inject_stdin；source 硬编码 UserDirect（wire 无协商）。
        MuxOp::Send { pane_id, data } => host
            .inject_stdin(&pane_id, &data, InjectionSource::UserDirect)
            .map(|_| MuxPayload::Sent),
        MuxOp::Capture(r) => host.capture(r).map(MuxPayload::Captured),
        MuxOp::Resize { pane_id, size } => {
            host.resize(&pane_id, size).map(|_| MuxPayload::Resized)
        }
        MuxOp::KillTree { pane_id } => host.kill(&pane_id).map(|_| MuxPayload::Killed),
        MuxOp::ListPanes => Ok(MuxPayload::Panes(host.list_panes())),
        MuxOp::ListThemes => Ok(MuxPayload::Themes(crate::theme::builtin_terminal_themes())),
        MuxOp::KillServer => Ok(MuxPayload::ServerKillScheduled),
        // D-5 订阅：维护本连接订阅集（fan-out 据此投递）。
        MuxOp::Subscribe { pane_id } => {
            conn.subscriptions.lock().unwrap_or_else(recover).insert(pane_id);
            Ok(MuxPayload::Subscribed)
        }
        MuxOp::Unsubscribe { pane_id } => {
            conn.subscriptions
                .lock()
                .unwrap_or_else(recover)
                .remove(&pane_id);
            Ok(MuxPayload::Unsubscribed)
        }
        // D-6 attach（限速 + 并发=1，D-7）：见 attach_with_limits。
        MuxOp::Attach { pane_id } => attach_with_limits(shared, conn, pane_id),
        // M2c：主题热切换需向订阅者广播 ThemeChanged（依赖广播面）。
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

/// Attach 处理（D-6 无缝拼接 + D-7 限速）：
/// 1. per-连接 ≥500ms 限速（防快照放大 DoS）；2. per-pane 并发快照=1（进行中再 Attach 回 Busy）；
/// 3. **先注册订阅、后取快照**（注册到快照间事件按 seq>last_seq 去重，无丢无重）。
fn attach_with_limits(
    shared: &Arc<DaemonShared>,
    conn: &ConnHandle,
    pane_id: PaneId,
) -> Result<MuxPayload, ConmuxError> {
    // D-7 限速：per-连接 attach 间隔 ≥500ms（被拒亦更新时刻，限制尝试频率）。
    {
        let mut last = conn.last_attach_at.lock().unwrap_or_else(recover);
        if let Some(t) = *last {
            if t.elapsed() < ATTACH_MIN_INTERVAL {
                return Err(ConmuxError::Busy {
                    message: "attach 过于频繁（<500ms），稍后重试".into(),
                });
            }
        }
        *last = Some(Instant::now());
    }
    // D-7 per-pane 并发快照=1：进行中再 Attach 同 pane → Busy（避免快照放大叠加）。
    {
        let mut set = shared.attaching.lock().unwrap_or_else(recover);
        if !set.insert(pane_id.clone()) {
            return Err(ConmuxError::Busy {
                message: "该 pane 正在被另一 attach 取快照，稍后重试".into(),
            });
        }
    }
    // 先注册订阅（D-6），后取快照；无论成败清并发标记。
    conn.subscriptions
        .lock()
        .unwrap_or_else(recover)
        .insert(pane_id.clone());
    let result = shared.host.attach_snapshot(&pane_id);
    shared
        .attaching
        .lock()
        .unwrap_or_else(recover)
        .remove(&pane_id);
    match result {
        Ok(snap) => Ok(MuxPayload::AttachSnapshot {
            mode_preamble_b64: b64(&snap.mode_preamble),
            history_b64: b64(&snap.history),
            last_seq: snap.last_seq,
            pane_state: snap.pane_state,
        }),
        Err(e) => {
            // 快照失败：回滚订阅。
            conn.subscriptions
                .lock()
                .unwrap_or_else(recover)
                .remove(&pane_id);
            Err(e)
        }
    }
}

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// 事件近似字节数（背压记账；PaneOutput 数据是主量）。
fn notify_bytes(notify: &MuxNotify) -> usize {
    match notify {
        MuxNotify::PaneOutput { data, .. } => data.len() + 64,
        _ => 128,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PaneId, PaneSize};
    use std::io::Cursor;

    fn test_shared() -> Arc<DaemonShared> {
        let conns = Arc::new(Mutex::new(HashMap::new()));
        let host = PaneHost::new_windows(
            Vec::new(),
            Arc::new(FanoutSink {
                conns: Arc::clone(&conns),
            }),
        );
        Arc::new(DaemonShared {
            host,
            running: AtomicBool::new(true),
            pipe_name: "test".into(),
            conns,
            next_conn_id: AtomicU64::new(1),
            attaching: Mutex::new(HashSet::new()),
        })
    }

    fn test_conn() -> (Arc<ConnHandle>, Receiver<Outbound>) {
        let (tx, rx) = channel();
        (
            Arc::new(ConnHandle {
                tx,
                queued_bytes: AtomicUsize::new(0),
                dead: AtomicBool::new(false),
                subscriptions: Mutex::new(HashSet::new()),
                last_attach_at: Mutex::new(None),
            }),
            rx,
        )
    }

    /// 把客户端帧序列编码进 Cursor（reader 喂入）。
    fn reader_with(frames: &[WireFrame]) -> Cursor<Vec<u8>> {
        let mut buf = Vec::new();
        for f in frames {
            write_frame(&mut buf, f).unwrap();
        }
        Cursor::new(buf)
    }

    /// 抽出 writer 队列里的全部回帧。
    fn drain_frames(rx: &Receiver<Outbound>) -> Vec<WireFrame> {
        let mut v = Vec::new();
        while let Ok(item) = rx.try_recv() {
            if let Outbound::Frame(f, _) = item {
                v.push(f);
            }
        }
        v
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

    /// I-5：身份不可得 ⇒ RejectedNoIdentity，不入任何回帧（无 HelloAck）。
    #[test]
    fn no_identity_is_rejected_before_handshake() {
        let mut r = reader_with(&[hello(PROTOCOL_VERSION)]);
        let (conn, rx) = test_conn();
        let outcome = serve_connection(&mut r, None, &test_shared(), &conn);
        assert_eq!(outcome, ConnOutcome::RejectedNoIdentity);
        assert!(drain_frames(&rx).is_empty(), "拒连不应回任何帧");
    }

    /// D-4：握手版本不匹配 ⇒ RejectedBadVersion，无 HelloAck。
    #[test]
    fn wrong_protocol_version_is_rejected() {
        let mut r = reader_with(&[hello(PROTOCOL_VERSION + 99)]);
        let (conn, rx) = test_conn();
        let outcome = serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        assert_eq!(outcome, ConnOutcome::RejectedBadVersion);
        assert!(drain_frames(&rx).is_empty());
    }

    /// H-2：首帧非 Hello ⇒ RejectedBadFirstFrame。
    #[test]
    fn non_hello_first_frame_is_rejected() {
        let mut r = reader_with(&[request(MuxOp::ListPanes)]);
        let (conn, rx) = test_conn();
        let outcome = serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        assert_eq!(outcome, ConnOutcome::RejectedBadFirstFrame);
        assert!(drain_frames(&rx).is_empty());
    }

    /// H-2：握手后收到非 Request 方向帧 ⇒ RejectedBadDirection（但已回 HelloAck）。
    #[test]
    fn wrong_direction_after_handshake_is_rejected() {
        let notify = WireFrame::Notify(MuxNotify::PaneExited {
            pane_id: PaneId("x".into()),
            exit_code: None,
        });
        let mut r = reader_with(&[hello(PROTOCOL_VERSION), notify]);
        let (conn, rx) = test_conn();
        let outcome = serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        assert_eq!(outcome, ConnOutcome::RejectedBadDirection);
        let replies = drain_frames(&rx);
        assert_eq!(replies.len(), 1);
        assert!(matches!(replies[0], WireFrame::HelloAck { .. }));
    }

    /// happy path：Hello + ListPanes + EOF ⇒ HelloAck + Reply(Panes 空) + Closed。
    #[test]
    fn handshake_then_listpanes_replies_ok() {
        let mut r = reader_with(&[hello(PROTOCOL_VERSION), request(MuxOp::ListPanes)]);
        let (conn, rx) = test_conn();
        let outcome = serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        assert_eq!(outcome, ConnOutcome::Closed);
        let replies = drain_frames(&rx);
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
        let mut r = reader_with(&[hello(PROTOCOL_VERSION), request(MuxOp::KillServer)]);
        let (conn, rx) = test_conn();
        let outcome = serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        assert_eq!(outcome, ConnOutcome::KillServerRequested);
        let replies = drain_frames(&rx);
        assert!(matches!(
            replies.last(),
            Some(WireFrame::Reply(MuxReply::Ok {
                payload: MuxPayload::ServerKillScheduled,
                ..
            }))
        ));
    }

    /// D-5：Subscribe 把 pane 加入本连接订阅集（后续 fan-out 据此投递）。
    #[test]
    fn subscribe_registers_in_connection_set() {
        let mut r = reader_with(&[
            hello(PROTOCOL_VERSION),
            request(MuxOp::Subscribe {
                pane_id: PaneId("p1".into()),
            }),
        ]);
        let (conn, rx) = test_conn();
        serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        assert!(
            conn.is_subscribed(&PaneId("p1".into())),
            "Subscribe 后订阅集应含 p1"
        );
        let replies = drain_frames(&rx);
        assert!(matches!(
            replies.last(),
            Some(WireFrame::Reply(MuxReply::Ok {
                payload: MuxPayload::Subscribed,
                ..
            }))
        ));
    }

    /// Unsubscribe 移除订阅。
    #[test]
    fn unsubscribe_removes_from_set() {
        let mut r = reader_with(&[
            hello(PROTOCOL_VERSION),
            request(MuxOp::Subscribe {
                pane_id: PaneId("p1".into()),
            }),
            request(MuxOp::Unsubscribe {
                pane_id: PaneId("p1".into()),
            }),
        ]);
        let (conn, _rx) = test_conn();
        serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        assert!(!conn.is_subscribed(&PaneId("p1".into())));
    }

    /// Attach 不存在的 pane ⇒ 订阅回滚 + 回 PaneNotFound（不留悬空订阅）。
    #[test]
    fn attach_unknown_pane_rolls_back_subscription() {
        let mut r = reader_with(&[
            hello(PROTOCOL_VERSION),
            request(MuxOp::Attach {
                pane_id: PaneId("nope".into()),
            }),
        ]);
        let (conn, rx) = test_conn();
        serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        assert!(
            !conn.is_subscribed(&PaneId("nope".into())),
            "attach 快照失败应回滚订阅"
        );
        let replies = drain_frames(&rx);
        assert!(matches!(
            replies.last(),
            Some(WireFrame::Reply(MuxReply::Err {
                error: ConmuxError::PaneNotFound { .. },
                ..
            }))
        ));
    }

    /// 背压：排队字节超 8 MiB ⇒ 连接置 dead + 发 Disconnect（D-7）。
    #[test]
    fn backpressure_disconnects_over_limit() {
        let (conn, rx) = test_conn();
        // 入队一帧标记 9 MiB（超限）。
        conn.enqueue(
            WireFrame::Notify(MuxNotify::PaneExited {
                pane_id: PaneId("p".into()),
                exit_code: None,
            }),
            9 * 1024 * 1024,
        );
        assert!(conn.dead.load(Ordering::Relaxed), "超限应置 dead");
        // 队列里应是 Disconnect（非 Frame）。
        assert!(matches!(rx.try_recv(), Ok(Outbound::Disconnect)));
        // dead 后再入队被丢弃。
        conn.enqueue(
            WireFrame::Notify(MuxNotify::PaneExited {
                pane_id: PaneId("p".into()),
                exit_code: None,
            }),
            10,
        );
        assert!(rx.try_recv().is_err(), "dead 后不再入队");
    }

    /// M2a-M3：关闭中 Spawn 被拒（不回成功应答）。
    #[test]
    fn spawn_rejected_during_shutdown() {
        let spawn = request(MuxOp::Spawn(crate::pane::SpawnRequest {
            pane_id: PaneId("x".into()),
            command: crate::pane::CommandSpec {
                program: "cmd.exe".into(),
                args: vec![],
                cwd: None,
                env: vec![],
            },
            size: PaneSize { rows: 24, cols: 80 },
            adapter_id: "shell".into(),
            display_name: None,
            created_at: 0,
        }));
        let mut r = reader_with(&[hello(PROTOCOL_VERSION), spawn]);
        let (conn, rx) = test_conn();
        let shared = test_shared();
        shared.running.store(false, Ordering::SeqCst);
        serve_connection(&mut r, Some(1234), &shared, &conn);
        let replies = drain_frames(&rx);
        assert!(matches!(
            replies.last(),
            Some(WireFrame::Reply(MuxReply::Err {
                error: ConmuxError::SupervisorError { .. },
                ..
            }))
        ));
    }

    /// D-7：同连接 <500ms 内两次 Attach 同 pane，第二次回 Busy（限速防快照放大）。
    #[test]
    fn rapid_attach_is_rate_limited() {
        let mut r = reader_with(&[
            hello(PROTOCOL_VERSION),
            request(MuxOp::Attach {
                pane_id: PaneId("p".into()),
            }),
            request(MuxOp::Attach {
                pane_id: PaneId("p".into()),
            }),
        ]);
        let (conn, rx) = test_conn();
        serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        let replies = drain_frames(&rx);
        // 第一次：pane 不存在 → PaneNotFound（限速已记时刻）；第二次：<500ms → Busy。
        let errs: Vec<_> = replies
            .iter()
            .filter_map(|f| match f {
                WireFrame::Reply(MuxReply::Err { error, .. }) => Some(error),
                _ => None,
            })
            .collect();
        assert_eq!(errs.len(), 2, "两次 attach 各回一个 Err");
        assert!(matches!(errs[0], ConmuxError::PaneNotFound { .. }));
        assert!(
            matches!(errs[1], ConmuxError::Busy { .. }),
            "第二次快速 attach 应被限速 Busy，实际: {:?}",
            errs[1]
        );
    }

    /// SetTheme 仍 Unsupported（M2c 广播）。
    #[test]
    fn set_theme_unsupported_in_m2b() {
        let mut r = reader_with(&[
            hello(PROTOCOL_VERSION),
            request(MuxOp::SetTheme {
                id: "b-dark-ink".into(),
            }),
        ]);
        let (conn, rx) = test_conn();
        serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        let replies = drain_frames(&rx);
        assert!(matches!(
            replies.last(),
            Some(WireFrame::Reply(MuxReply::Err {
                error: ConmuxError::Unsupported { .. },
                ..
            }))
        ));
    }

    /// ListThemes 可用。
    #[test]
    fn list_themes_works() {
        let mut r = reader_with(&[hello(PROTOCOL_VERSION), request(MuxOp::ListThemes)]);
        let (conn, rx) = test_conn();
        serve_connection(&mut r, Some(1234), &test_shared(), &conn);
        let replies = drain_frames(&rx);
        match replies.last() {
            Some(WireFrame::Reply(MuxReply::Ok {
                payload: MuxPayload::Themes(themes),
                ..
            })) => assert!(!themes.is_empty()),
            other => panic!("应为 Ok(Themes)，实际: {other:?}"),
        }
    }
}
