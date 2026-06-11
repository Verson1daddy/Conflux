//! Pane 抽象与 PaneHost 门面（API 契约 §2 / MF-1/4/6）。
//!
//! 机制层核心：`PaneHost` 是对外门面（spawn/kill/respawn/resize/inject/list）；
//! `PaneBackend`/`PaneSession` 是**内部** trait（`pub(crate)`，不导出），由 `Pane`
//! 私有持有——**模块外无法拿到可写 PTY 句柄**，这把 MF-1「唯一注入路径」做成类型级密封。
//!
//! 唯一写链（冻结）：`InjectionHook 链 → PaneHost::inject_stdin → session.write_all`。
//! 三环之外无写：`PaneSession` 无 `writer()` getter、`Box<dyn Write>` 不出现在任何签名。
//!
//! 本子步（cutover 2a）以 mock backend 立起**注入/生命周期**机制不变量；真实 Windows
//! 后端（portable-pty 0.9 + JobObjectSupervisor + 读线程 + capture）在系统集成子步（2b）落地。

use std::collections::HashMap;
use std::sync::Mutex;

use crate::inject::{InjectionContext, InjectionHook};
use crate::job::{ProcessSupervisor, SupervisorFactory};
use crate::types::{InjectionSource, PaneId, PaneLifecycle, PaneSize, PaneState, ScrollbackInfo};
use crate::ConmuxError;

/// 进程启动规格（契约 §13 空白-1 裁决：spawn cwd 用 `cwd`，与 `PaneState.working_dir`
/// 展示语义区分）。retrofit 自 conflux `pty/manager.rs` 的 `CommandBuilder`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    /// 进程实际 cwd（spawn 入参）；None = 继承当前目录。
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
}

/// spawn 请求。`pane_id` 由调用方提供（= conflux instance_id，契约 §1 不改 ID 体系）——
/// conmux 不生成 ID，避免引入 uuid 依赖且对齐"PaneId == InstanceId"。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnRequest {
    pub pane_id: PaneId,
    pub command: CommandSpec,
    pub size: PaneSize,
    pub adapter_id: String,
    pub display_name: Option<String>,
    /// 创建时间（Unix ms，调用方提供以保持可测/可重放确定性）。
    pub created_at: i64,
}

// ===== 内部 trait（pub(crate)，不导出——MF-1 隐私墙）=====

/// 后端工厂：打开一个未 spawn 的 PTY 会话。
pub(crate) trait PaneBackend: Send + Sync {
    fn open(&self, size: PaneSize) -> Result<Box<dyn PaneSession>, ConmuxError>;
}

/// 单个 PTY 会话。由 `Pane` 私有持有，模块外不可达。
///
/// **MF-1 不变量**：无任何返回可写句柄的方法（无 `writer()`）；唯一写方法 `write_all`
/// 仅经 `PaneHost::inject_stdin` 调用。`take_reader` 一次性移交、二次返回 Err。
pub(crate) trait PaneSession: Send {
    fn spawn(&mut self, cmd: &CommandSpec) -> Result<u32 /*pid*/, ConmuxError>;
    /// 一次性移交读端：仅 spawn 后由 PaneHost 调一次、立即交读线程；二次调用返回 Err。
    /// （读线程接线在系统集成子步 2b；此前仅 mock 测试覆盖一次性语义。）
    #[allow(dead_code)]
    fn take_reader(&mut self) -> Result<Box<dyn std::io::Read + Send>, ConmuxError>;
    fn resize(&self, size: PaneSize) -> Result<(), ConmuxError>;
    /// 唯一写方法（MF-1）。trait 对象被 Pane 私有持有，模块外不可达。
    fn write_all(&mut self, data: &[u8]) -> Result<(), ConmuxError>;
}

/// 单个 pane 的运行时状态（`pub(crate)`，私有字段——不导出本体，仅经 `PaneState` 暴露语义）。
pub(crate) struct Pane {
    session: Box<dyn PaneSession>,
    supervisor: Box<dyn ProcessSupervisor>,
    lifecycle: PaneLifecycle,
    pid: Option<u32>,
    exit_code: Option<i32>,
    adapter_id: String,
    display_name: Option<String>,
    working_dir: String,
    size: PaneSize,
    created_at: i64,
}

impl Pane {
    fn to_state(&self, pane_id: &PaneId) -> PaneState {
        PaneState {
            pane_id: pane_id.clone(),
            adapter_id: self.adapter_id.clone(),
            display_name: self.display_name.clone(),
            lifecycle: self.lifecycle.clone(),
            pid: self.pid,
            exit_code: self.exit_code,
            working_dir: self.working_dir.clone(),
            size: self.size,
            // scrollback 在系统集成子步接 LineIndexedBuffer 后填实；此处占位。
            scrollback: ScrollbackInfo {
                total_bytes: 0,
                first_abs_line: 0,
                last_abs_line: 0,
            },
            created_at: self.created_at,
        }
    }
}

/// PaneHost 构造配置：后端工厂、监管器工厂、注入钩子链。
///
/// **`pub(crate)`——backend/supervisor 是 conmux 内部（Windows ConPTY / JobObject），
/// conflux 不提供它们**。2a 仅 mock 测试经此构造；2b 将加公开 `PaneHost::new_windows(
/// hooks, event_sink, runtime)` 内部装配 Windows 后端 + JobObjectSupervisor。
// 2a：仅 test 构造（2b Windows 构造器会用），lib build 暂为 dead。
#[allow(dead_code)]
pub(crate) struct PaneHostConfig {
    pub(crate) backend: Box<dyn PaneBackend>,
    pub(crate) supervisor_factory: Box<dyn SupervisorFactory>,
    pub(crate) hooks: Vec<std::sync::Arc<dyn InjectionHook>>,
}

/// 对外门面。私有持有 pane 表；唯一写入口 `inject_stdin`（MF-1）。
pub struct PaneHost {
    backend: Box<dyn PaneBackend>,
    supervisor_factory: Box<dyn SupervisorFactory>,
    hooks: Vec<std::sync::Arc<dyn InjectionHook>>,
    panes: Mutex<HashMap<PaneId, Pane>>,
}

impl PaneHost {
    /// `pub(crate)`——2a 经 mock parts 构造（测试）；2b 加公开 Windows 构造器。
    #[allow(dead_code)] // 2a：仅 test 调用；2b Windows 构造器会用。
    pub(crate) fn new(config: PaneHostConfig) -> Self {
        Self {
            backend: config.backend,
            supervisor_factory: config.supervisor_factory,
            hooks: config.hooks,
            panes: Mutex::new(HashMap::new()),
        }
    }

    /// spawn 一个 pane：backend.open → session.spawn → 监管器 assign（fail-closed，MF-4）
    /// → 注册。assign 失败 ⇒ 不注册（不产生无监管 pane）。读线程/capture 接线在 2b。
    pub fn spawn(&self, req: SpawnRequest) -> Result<PaneId, ConmuxError> {
        {
            let panes = self.panes.lock().expect("panes 锁未中毒");
            if panes.contains_key(&req.pane_id) {
                return Err(ConmuxError::SpawnFailed {
                    message: format!("pane_id 已存在: {}", req.pane_id.0),
                });
            }
        }

        let mut session = self.backend.open(req.size)?;
        let pid = session.spawn(&req.command)?;

        // 每 pane 一个监管器；assign 失败 = fail-closed（MF-4 cl.2）：返回 Err、不注册。
        // 真实后端在此处还须 best-effort kill 已 spawn 的 pid（2b WindowsBackend 落地）。
        let supervisor = self.supervisor_factory.create();
        if let Err(e) = supervisor.assign(pid) {
            return Err(ConmuxError::SupervisorError {
                message: format!("assign 失败，已 fail-closed 拒绝 pane: {e}"),
            });
        }

        let working_dir = req.command.cwd.clone().unwrap_or_default();
        let pane = Pane {
            session,
            supervisor,
            lifecycle: PaneLifecycle::Running,
            pid: Some(pid),
            exit_code: None,
            adapter_id: req.adapter_id,
            display_name: req.display_name,
            working_dir,
            size: req.size,
            created_at: req.created_at,
        };
        self.panes
            .lock()
            .expect("panes 锁未中毒")
            .insert(req.pane_id.clone(), pane);
        Ok(req.pane_id)
    }

    /// **唯一对外写入口**（MF-1）。顺序不变量（MF-6）：
    /// before_inject（全部钩子，任一 Err ⇒ 不写）→ session.write_all → after_inject。
    /// `source` 由调用方按**信道身份**传入（in-proc 命令边界硬编码 / V2 管道客户端身份），
    /// **不来自** `MuxOp::Send`（它无 source 字段，MF-2）。
    pub fn inject_stdin(
        &self,
        pane_id: &PaneId,
        data: &[u8],
        source: InjectionSource,
    ) -> Result<(), ConmuxError> {
        let mut panes = self.panes.lock().expect("panes 锁未中毒");
        let pane = panes
            .get_mut(pane_id)
            .ok_or_else(|| ConmuxError::PaneNotFound {
                pane_id: pane_id.0.clone(),
            })?;

        let ctx = InjectionContext {
            pane_id,
            source,
            byte_len: data.len(),
            content: data,
        };

        // MF-6 fail-closed：任一 before_inject Err ⇒ 字节绝不抵达 PTY。
        for hook in &self.hooks {
            if let Err(e) = hook.before_inject(&ctx) {
                // 通知 after_inject 该次被拒（结果即该 Err），便于审计追加 Failed。
                let rejected: Result<(), ConmuxError> = Err(e.clone());
                for h in &self.hooks {
                    h.after_inject(&ctx, &rejected);
                }
                return Err(e);
            }
        }

        let result = pane.session.write_all(data);
        for hook in &self.hooks {
            hook.after_inject(&ctx, &result);
        }
        result
    }

    /// 整树终结（走 supervisor.kill_tree，MF-4）。**无论 kill_tree 成败，pane 一律从表移除**
    /// （MF-4 cl.4：失败仍清理，调用方据返回的 Err 决定是否标 zombie/上报）。
    pub fn kill(&self, pane_id: &PaneId) -> Result<(), ConmuxError> {
        let pane = {
            let mut panes = self.panes.lock().expect("panes 锁未中毒");
            panes
                .remove(pane_id)
                .ok_or_else(|| ConmuxError::PaneNotFound {
                    pane_id: pane_id.0.clone(),
                })?
        };
        // pane 已移除（内部表干净）；kill_tree 结果回传调用方。session 随 pane drop 释放。
        pane.supervisor.kill_tree()
    }

    /// 在同一 pane_id 下重起（先 kill_tree 旧的——若存在——再 spawn）。
    pub fn respawn(&self, pane_id: &PaneId, req: SpawnRequest) -> Result<(), ConmuxError> {
        // 旧 pane 存在则整树终结（忽略 kill 错误：可能已自退）。
        if let Some(old) = self
            .panes
            .lock()
            .expect("panes 锁未中毒")
            .remove(pane_id)
        {
            let _ = old.supervisor.kill_tree();
        }
        // req.pane_id 应与 pane_id 一致（调用方保证）。
        self.spawn(req).map(|_| ())
    }

    pub fn resize(&self, pane_id: &PaneId, size: PaneSize) -> Result<(), ConmuxError> {
        let mut panes = self.panes.lock().expect("panes 锁未中毒");
        let pane = panes
            .get_mut(pane_id)
            .ok_or_else(|| ConmuxError::PaneNotFound {
                pane_id: pane_id.0.clone(),
            })?;
        pane.session.resize(size)?;
        pane.size = size;
        Ok(())
    }

    /// 对账/死亡检测用。
    pub fn list_panes(&self) -> Vec<PaneState> {
        let panes = self.panes.lock().expect("panes 锁未中毒");
        panes.iter().map(|(id, pane)| pane.to_state(id)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    // ===== Mock backend / session =====

    #[derive(Default)]
    struct MockSessionState {
        written: Vec<Vec<u8>>,
        reader_taken: bool,
        resized_to: Option<PaneSize>,
        spawn_should_fail: bool,
    }

    #[derive(Clone)]
    struct MockSession {
        state: Arc<StdMutex<MockSessionState>>,
        pid: u32,
    }

    impl PaneSession for MockSession {
        fn spawn(&mut self, _cmd: &CommandSpec) -> Result<u32, ConmuxError> {
            if self.state.lock().unwrap().spawn_should_fail {
                return Err(ConmuxError::SpawnFailed {
                    message: "mock spawn fail".into(),
                });
            }
            Ok(self.pid)
        }
        fn take_reader(&mut self) -> Result<Box<dyn std::io::Read + Send>, ConmuxError> {
            let mut s = self.state.lock().unwrap();
            if s.reader_taken {
                return Err(ConmuxError::PtyError {
                    message: "reader 已被移交".into(),
                });
            }
            s.reader_taken = true;
            Ok(Box::new(std::io::empty()))
        }
        fn resize(&self, size: PaneSize) -> Result<(), ConmuxError> {
            self.state.lock().unwrap().resized_to = Some(size);
            Ok(())
        }
        fn write_all(&mut self, data: &[u8]) -> Result<(), ConmuxError> {
            self.state.lock().unwrap().written.push(data.to_vec());
            Ok(())
        }
    }

    struct MockBackend {
        state: Arc<StdMutex<MockSessionState>>,
        pid: u32,
    }
    impl PaneBackend for MockBackend {
        fn open(&self, _size: PaneSize) -> Result<Box<dyn PaneSession>, ConmuxError> {
            Ok(Box::new(MockSession {
                state: Arc::clone(&self.state),
                pid: self.pid,
            }))
        }
    }

    // ===== Mock supervisor (records assign/kill_tree via shared state) =====

    #[derive(Default)]
    struct SupervisorRecord {
        assigned_pids: Vec<u32>,
        kill_tree_calls: u32,
        assign_should_fail: bool,
        kill_tree_should_fail: bool,
    }

    struct MockSupervisor {
        rec: Arc<StdMutex<SupervisorRecord>>,
    }
    impl ProcessSupervisor for MockSupervisor {
        fn assign(&self, pid: u32) -> Result<(), ConmuxError> {
            let mut r = self.rec.lock().unwrap();
            if r.assign_should_fail {
                return Err(ConmuxError::SupervisorError {
                    message: "mock assign fail".into(),
                });
            }
            r.assigned_pids.push(pid);
            Ok(())
        }
        fn kill_tree(&self) -> Result<(), ConmuxError> {
            let mut r = self.rec.lock().unwrap();
            r.kill_tree_calls += 1;
            if r.kill_tree_should_fail {
                return Err(ConmuxError::SupervisorError {
                    message: "mock kill_tree fail".into(),
                });
            }
            Ok(())
        }
    }

    struct MockSupervisorFactory {
        rec: Arc<StdMutex<SupervisorRecord>>,
    }
    impl SupervisorFactory for MockSupervisorFactory {
        fn create(&self) -> Box<dyn ProcessSupervisor> {
            Box::new(MockSupervisor {
                rec: Arc::clone(&self.rec),
            })
        }
    }

    // ===== Recording injection hook =====

    #[derive(Default)]
    struct HookRecord {
        before_calls: Vec<(String, InjectionSource, usize)>, // (pane_id, source, byte_len)
        after_calls: Vec<bool>,                              // result.is_ok()
        before_should_fail: bool,
    }
    struct RecordingHook {
        rec: Arc<StdMutex<HookRecord>>,
        /// 与 session 共享，用于断言"before_inject Err 时 write_all 未被调用"。
        session_state: Arc<StdMutex<MockSessionState>>,
    }
    impl InjectionHook for RecordingHook {
        fn before_inject(&self, ctx: &InjectionContext) -> Result<(), ConmuxError> {
            let mut r = self.rec.lock().unwrap();
            r.before_calls
                .push((ctx.pane_id.0.clone(), ctx.source.clone(), ctx.byte_len));
            if r.before_should_fail {
                // 断言点：此刻 write_all 必须还没发生。
                assert!(
                    self.session_state.lock().unwrap().written.is_empty(),
                    "fail-closed 破坏：before_inject 拒绝前不应已写 PTY"
                );
                return Err(ConmuxError::InjectionRejected {
                    reason: "mock reject".into(),
                });
            }
            Ok(())
        }
        fn after_inject(&self, _ctx: &InjectionContext, result: &Result<(), ConmuxError>) {
            self.rec.lock().unwrap().after_calls.push(result.is_ok());
        }
    }

    // ===== 测试夹具 =====

    struct Fixture {
        host: PaneHost,
        session_state: Arc<StdMutex<MockSessionState>>,
        sup_rec: Arc<StdMutex<SupervisorRecord>>,
        hook_rec: Arc<StdMutex<HookRecord>>,
    }

    fn fixture_with_pid(pid: u32) -> Fixture {
        let session_state = Arc::new(StdMutex::new(MockSessionState::default()));
        let sup_rec = Arc::new(StdMutex::new(SupervisorRecord::default()));
        let hook_rec = Arc::new(StdMutex::new(HookRecord::default()));
        let hook = RecordingHook {
            rec: Arc::clone(&hook_rec),
            session_state: Arc::clone(&session_state),
        };
        let host = PaneHost::new(PaneHostConfig {
            backend: Box::new(MockBackend {
                state: Arc::clone(&session_state),
                pid,
            }),
            supervisor_factory: Box::new(MockSupervisorFactory {
                rec: Arc::clone(&sup_rec),
            }),
            hooks: vec![Arc::new(hook)],
        });
        Fixture {
            host,
            session_state,
            sup_rec,
            hook_rec,
        }
    }

    fn req(id: &str) -> SpawnRequest {
        SpawnRequest {
            pane_id: PaneId(id.into()),
            command: CommandSpec {
                program: "cmd.exe".into(),
                args: vec![],
                cwd: Some("D:\\repo".into()),
                env: vec![],
            },
            size: PaneSize { rows: 24, cols: 80 },
            adapter_id: "claude-code".into(),
            display_name: Some("rev".into()),
            created_at: 1_700_000_000,
        }
    }

    #[test]
    fn spawn_registers_running_pane_and_assigns_supervisor() {
        let f = fixture_with_pid(4242);
        let id = f.host.spawn(req("p1")).unwrap();
        assert_eq!(id, PaneId("p1".into()));
        let panes = f.host.list_panes();
        assert_eq!(panes.len(), 1);
        assert_eq!(panes[0].lifecycle, PaneLifecycle::Running);
        assert_eq!(panes[0].pid, Some(4242));
        assert_eq!(panes[0].adapter_id, "claude-code");
        assert_eq!(panes[0].working_dir, "D:\\repo");
        // 监管器被创建并 assign 了该 pid（MF-4）。
        assert_eq!(f.sup_rec.lock().unwrap().assigned_pids, vec![4242]);
    }

    #[test]
    fn spawn_duplicate_id_rejected() {
        let f = fixture_with_pid(1);
        f.host.spawn(req("dup")).unwrap();
        assert!(matches!(
            f.host.spawn(req("dup")),
            Err(ConmuxError::SpawnFailed { .. })
        ));
    }

    #[test]
    fn spawn_assign_failure_is_fail_closed_no_pane_registered() {
        let f = fixture_with_pid(7);
        f.sup_rec.lock().unwrap().assign_should_fail = true;
        let r = f.host.spawn(req("p"));
        assert!(matches!(r, Err(ConmuxError::SupervisorError { .. })));
        assert!(
            f.host.list_panes().is_empty(),
            "assign 失败不得产生无监管 pane（MF-4 cl.2）"
        );
    }

    #[test]
    fn spawn_backend_failure_propagates() {
        let f = fixture_with_pid(1);
        f.session_state.lock().unwrap().spawn_should_fail = true;
        assert!(matches!(
            f.host.spawn(req("p")),
            Err(ConmuxError::SpawnFailed { .. })
        ));
        assert!(f.host.list_panes().is_empty());
    }

    #[test]
    fn inject_routes_through_hook_then_write_in_order() {
        let f = fixture_with_pid(1);
        f.host.spawn(req("p1")).unwrap();
        f.host
            .inject_stdin(&PaneId("p1".into()), b"hello", InjectionSource::UserDirect)
            .unwrap();
        // before_inject 被调用，带正确 pane_id/source/byte_len（MF-2/MF-3 上下文）。
        let hr = f.hook_rec.lock().unwrap();
        assert_eq!(hr.before_calls.len(), 1);
        assert_eq!(hr.before_calls[0].0, "p1");
        assert_eq!(hr.before_calls[0].1, InjectionSource::UserDirect);
        assert_eq!(hr.before_calls[0].2, 5);
        assert_eq!(hr.after_calls, vec![true]);
        // write_all 收到字节（唯一写链 hook → inject_stdin → write_all）。
        assert_eq!(f.session_state.lock().unwrap().written, vec![b"hello".to_vec()]);
    }

    #[test]
    fn inject_fail_closed_when_before_hook_rejects() {
        let f = fixture_with_pid(1);
        f.host.spawn(req("p1")).unwrap();
        f.hook_rec.lock().unwrap().before_should_fail = true;
        let r = f
            .host
            .inject_stdin(&PaneId("p1".into()), b"x", InjectionSource::OrchestrationAuto);
        assert!(matches!(r, Err(ConmuxError::InjectionRejected { .. })));
        // 关键：被拒后字节绝不抵达 PTY（MF-6 fail-closed）。
        assert!(
            f.session_state.lock().unwrap().written.is_empty(),
            "before_inject 拒绝 ⇒ write_all 必须未被调用"
        );
        // after_inject 仍被通知（结果为 Err），便于审计追加 Failed。
        assert_eq!(f.hook_rec.lock().unwrap().after_calls, vec![false]);
    }

    #[test]
    fn inject_source_is_caller_channel_identity_not_overridable() {
        // source 由调用方（信道身份）传入并原样进 ctx；不同信道身份得不同 source。
        let f = fixture_with_pid(1);
        f.host.spawn(req("p1")).unwrap();
        for src in [
            InjectionSource::UserDirect,
            InjectionSource::PermissionResponse,
            InjectionSource::DiscussionUserMessage,
        ] {
            f.host
                .inject_stdin(&PaneId("p1".into()), b"a", src.clone())
                .unwrap();
        }
        let seen: Vec<_> = f
            .hook_rec
            .lock()
            .unwrap()
            .before_calls
            .iter()
            .map(|(_, s, _)| s.clone())
            .collect();
        assert_eq!(
            seen,
            vec![
                InjectionSource::UserDirect,
                InjectionSource::PermissionResponse,
                InjectionSource::DiscussionUserMessage,
            ]
        );
    }

    #[test]
    fn inject_unknown_pane_returns_not_found() {
        let f = fixture_with_pid(1);
        assert!(matches!(
            f.host
                .inject_stdin(&PaneId("nope".into()), b"x", InjectionSource::UserDirect),
            Err(ConmuxError::PaneNotFound { .. })
        ));
    }

    #[test]
    fn kill_calls_kill_tree_and_removes_pane() {
        let f = fixture_with_pid(1);
        f.host.spawn(req("p1")).unwrap();
        f.host.kill(&PaneId("p1".into())).unwrap();
        assert_eq!(f.sup_rec.lock().unwrap().kill_tree_calls, 1);
        assert!(f.host.list_panes().is_empty());
    }

    #[test]
    fn kill_tree_failure_still_removes_pane_and_returns_err() {
        let f = fixture_with_pid(1);
        f.host.spawn(req("p1")).unwrap();
        f.sup_rec.lock().unwrap().kill_tree_should_fail = true;
        let r = f.host.kill(&PaneId("p1".into()));
        assert!(matches!(r, Err(ConmuxError::SupervisorError { .. })));
        // MF-4 cl.4：kill_tree 失败仍清理内部表（无 ghost）。
        assert!(f.host.list_panes().is_empty());
    }

    #[test]
    fn kill_unknown_pane_returns_not_found() {
        let f = fixture_with_pid(1);
        assert!(matches!(
            f.host.kill(&PaneId("nope".into())),
            Err(ConmuxError::PaneNotFound { .. })
        ));
    }

    #[test]
    fn resize_updates_size_and_calls_session() {
        let f = fixture_with_pid(1);
        f.host.spawn(req("p1")).unwrap();
        let ns = PaneSize { rows: 40, cols: 120 };
        f.host.resize(&PaneId("p1".into()), ns).unwrap();
        assert_eq!(f.session_state.lock().unwrap().resized_to, Some(ns));
        assert_eq!(f.host.list_panes()[0].size, ns);
        assert!(matches!(
            f.host.resize(&PaneId("nope".into()), ns),
            Err(ConmuxError::PaneNotFound { .. })
        ));
    }

    #[test]
    fn respawn_reuses_id_and_kills_old() {
        let f = fixture_with_pid(99);
        f.host.spawn(req("p1")).unwrap();
        f.host.respawn(&PaneId("p1".into()), req("p1")).unwrap();
        // 旧 pane 被 kill_tree（respawn 内），新 pane 复用同 id。
        assert!(f.sup_rec.lock().unwrap().kill_tree_calls >= 1);
        let panes = f.host.list_panes();
        assert_eq!(panes.len(), 1);
        assert_eq!(panes[0].pane_id, PaneId("p1".into()));
    }

    #[test]
    fn pane_session_take_reader_is_one_shot() {
        // MF-1：读端一次性移交，二次返回 Err（读句柄不可重复外发）。
        let state = Arc::new(StdMutex::new(MockSessionState::default()));
        let mut session = MockSession {
            state,
            pid: 1,
        };
        assert!(session.take_reader().is_ok());
        assert!(session.take_reader().is_err(), "二次 take_reader 必须 Err");
    }

    #[test]
    fn panehost_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<PaneHost>();
    }
}
