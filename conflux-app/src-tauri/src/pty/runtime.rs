// ===== PaneRuntime：conflux 策略层门面（cutover ③）=====
//
// 在 PtyManager 的**旧接口签名后面**切到 conmux::PaneHost（契约 §3.5 步骤 3）：
// 命令层只把 `state.pty_manager` 换成 `state.pane_runtime`，方法语义与 manager 持平
// （manager 的特征测试 1:1 移植到本模块，继续绿 = 无回归 gate）。
//
// 职责分配：
//   - 机制（spawn/inject/kill/respawn/resize/capture/poll_exit）→ conmux::PaneHost
//     （JobObject 整树监管 + DSR 应答 + 唯一注入写链 + 行索引 scrollback）
//   - 策略（AgentStatus/mode/hidden/display_name/活动时间戳/parser）→ InstanceMetaRegistry
//   - 视图合并（AgentInstanceInfo/AgentStateDetail）→ 本门面
//
// 与 manager 的语义差量（设计文档 §4 冻结）：
//   - kill = JobObject kill_tree（整树；原 child.kill() 留孤儿孙进程——X4 实测问题）
//   - get_pty_history 走 conmux capture（行索引 scrollback；原 OutputBuffer 字节环）
//   - is_process_exited 兜底从 child.try_wait() 换为 PaneHost::poll_exit（同语义）

use std::sync::Arc;

use conmux::{
    CaptureRange, CaptureRequest, CommandSpec, InjectionSource, PaneId, PaneSize, SpawnRequest,
};

use crate::adapter::traits::AgentAdapter;
use crate::core::{
    AdapterId, AgentInstanceInfo, AgentMode, AgentStateDetail, AgentStatus, AgentTree,
    ConfluxError, InstanceId, SubAgentInfo,
};
use crate::pty::meta::{InstanceMeta, InstanceMetaRegistry};
use crate::pty::parser::PtyOutputParser;

/// 默认 PTY 终端尺寸（与原 manager 一致：120 列 x 30 行）。
const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn not_found(instance_id: &str) -> ConfluxError {
    ConfluxError::InstanceNotFound {
        instance_id: instance_id.to_string(),
    }
}

/// Resolve a command name to a launchable executable on Windows.
///
/// `CreateProcessW` 只认 PE 可执行、不查 PATHEXT；npm-global CLI（claude 等）的首个
/// 命中是 bash shim（error 193）。手工走 PATH+PATHEXT 取 .cmd/.exe/.bat 真实路径。
/// 归属说明：暂留 conflux 策略层（V0 不动 conmux 机制库；是否下沉留 V1 议题）。
/// 原版位于 manager.rs（cutover ④ 随旧路径删除）。
#[cfg(windows)]
fn resolve_windows_command(command: &str) -> String {
    use std::path::{Path, PathBuf};

    let path = Path::new(command);

    if path.is_absolute() && path.extension().is_some() && path.exists() {
        return command.to_string();
    }

    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    let extensions: Vec<String> = pathext
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    let candidate_dirs: Vec<PathBuf> = if path.is_absolute() {
        match path.parent() {
            Some(parent) => vec![parent.to_path_buf()],
            None => return command.to_string(),
        }
    } else if path.components().count() > 1 {
        match path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => vec![parent.to_path_buf()],
            _ => vec![],
        }
    } else {
        std::env::var("PATH")
            .unwrap_or_default()
            .split(';')
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .collect()
    };

    let basename = path.file_stem().and_then(|s| s.to_str()).unwrap_or(command);

    for dir in &candidate_dirs {
        for ext in &extensions {
            let candidate = dir.join(format!("{}{}", basename, ext));
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }

    command.to_string()
}

#[cfg(not(windows))]
fn resolve_windows_command(command: &str) -> String {
    command.to_string()
}

/// 策略层门面——持 conmux::PaneHost（机制）+ InstanceMetaRegistry（策略）。
pub struct PaneRuntime {
    host: conmux::PaneHost,
    meta: Arc<InstanceMetaRegistry>,
}

impl PaneRuntime {
    /// Windows 构造：conflux 提供钩子链（PolicyHook/AuditHook）+ 事件出口（MuxEventBridge），
    /// conmux 内部装配 ConPTY 后端 + JobObject 监管。`meta` 与 bridge 共享同一 Arc。
    #[cfg(windows)]
    pub fn new_windows(
        hooks: Vec<Arc<dyn conmux::InjectionHook>>,
        event_sink: Arc<dyn conmux::PaneEventSink>,
        meta: Arc<InstanceMetaRegistry>,
    ) -> Self {
        Self {
            host: conmux::PaneHost::new_windows(hooks, event_sink),
            meta,
        }
    }

    /// 共享 meta 句柄（AppState 构造时给 bridge 用）。
    pub fn meta(&self) -> Arc<InstanceMetaRegistry> {
        Arc::clone(&self.meta)
    }

    /// 创建新实例（自生成 uuid）。orchestration sandbox spawn 路径用。
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self,
        command: &str,
        args: &[String],
        working_dir: &str,
        adapter_id: &str,
        adapter_name: &str,
        adapter: Option<Arc<dyn AgentAdapter>>,
        mode: AgentMode,
        hidden: bool,
        display_name: Option<String>,
    ) -> Result<String, ConfluxError> {
        self.spawn_with_id(
            uuid::Uuid::new_v4().to_string(),
            command,
            args,
            working_dir,
            adapter_id,
            adapter_name,
            adapter,
            mode,
            hidden,
            display_name,
        )
    }

    /// 用调用方预生成的 instance_id 启动（A.2 hook 注入 / respawn 复用 id 需要）。
    ///
    /// parser/meta 在 spawn **之前**注册——保证读线程第一块输出就能结构化解析；
    /// spawn 失败回滚 meta（不留 ghost）。
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_with_id(
        &self,
        instance_id: String,
        command: &str,
        args: &[String],
        working_dir: &str,
        adapter_id: &str,
        adapter_name: &str,
        adapter: Option<Arc<dyn AgentAdapter>>,
        mode: AgentMode,
        hidden: bool,
        display_name: Option<String>,
    ) -> Result<String, ConfluxError> {
        let now = now_millis();

        let parser = adapter.map(|adapter_arc| {
            Arc::new(parking_lot::Mutex::new(PtyOutputParser::new(
                InstanceId(instance_id.clone()),
                adapter_arc,
                adapter_name,
            )))
        });

        self.meta.register(
            &instance_id,
            InstanceMeta {
                adapter_id: adapter_id.to_string(),
                adapter_name: adapter_name.to_string(),
                display_name: display_name.clone(),
                status: AgentStatus::Idle,
                mode,
                hidden,
                last_activity_at: now,
                ended_at: None,
                exited: false,
                parser,
            },
        );

        let resolved_command = resolve_windows_command(command);
        if resolved_command != command {
            log::debug!("PTY spawn 路径解析: {} -> {}", command, resolved_command);
        }

        let req = SpawnRequest {
            pane_id: PaneId(instance_id.clone()),
            command: CommandSpec {
                program: resolved_command,
                args: args.to_vec(),
                cwd: Some(working_dir.to_string()),
                env: vec![], // 继承父进程环境（与原 manager 一致）
            },
            size: PaneSize {
                rows: DEFAULT_PTY_ROWS,
                cols: DEFAULT_PTY_COLS,
            },
            adapter_id: adapter_id.to_string(),
            display_name,
            created_at: now,
        };

        match self.host.spawn(req) {
            Ok(_) => {
                log::debug!("PTY spawn 完成: instance_id={instance_id}");
                Ok(instance_id)
            }
            Err(e) => {
                self.meta.remove(&instance_id);
                log::error!("PTY spawn 失败: instance_id={instance_id}, error={e}");
                Err(e.into())
            }
        }
    }

    /// 唯一注入通道（仅 `core/injection.rs::inject_with_policy` 调用，chokepoint 注释
    /// 见彼处）。policy/审计在 conmux 钩子链内发生（MF-1/5/6 库级保证）。
    pub fn inject_stdin(
        &self,
        instance_id: &str,
        input: &str,
        source: InjectionSource,
    ) -> Result<(), ConfluxError> {
        self.host
            .inject_stdin(&PaneId(instance_id.to_string()), input.as_bytes(), source)?;
        self.meta.touch(instance_id, now_millis());
        log::debug!(
            "inject_stdin 完成: instance_id={}, length={}",
            instance_id,
            input.len()
        );
        Ok(())
    }

    pub fn resize(&self, instance_id: &str, cols: u16, rows: u16) -> Result<(), ConfluxError> {
        self.host
            .resize(&PaneId(instance_id.to_string()), PaneSize { rows, cols })?;
        self.meta.touch(instance_id, now_millis());
        Ok(())
    }

    /// 终止实例（JobObject 整树终结）并清理 meta。
    ///
    /// kill_tree 失败不 fatal（与 manager「kill 失败可能进程已退，继续清理」语义持平）：
    /// conmux 已保证失败也从内部表移除（MF-4 cl.4），此处同样移除 meta + 记日志。
    pub fn kill(&self, instance_id: &str) -> Result<(), ConfluxError> {
        match self.host.kill(&PaneId(instance_id.to_string())) {
            Ok(()) => {
                self.meta.remove(instance_id);
                log::debug!("PTY kill 完成: instance_id={instance_id}");
                Ok(())
            }
            Err(conmux::ConmuxError::PaneNotFound { .. }) => Err(not_found(instance_id)),
            Err(e) => {
                self.meta.remove(instance_id);
                log::warn!("kill_tree 失败（pane 已移除，可能进程已自退）: instance_id={instance_id}, error={e}");
                Ok(())
            }
        }
    }

    /// 复用 instance_id 重启（ExitOverlay restart/shell + set_agent_mode）。
    /// 先 kill 旧（忽略错误：可能已自退/已 close）再以同 id spawn——meta/parser 经
    /// spawn_with_id 重新注册（不用 host.respawn：parser 注册必须先于 spawn）。
    #[allow(clippy::too_many_arguments)]
    pub fn respawn(
        &self,
        instance_id: &str,
        command: &str,
        args: &[String],
        working_dir: &str,
        adapter_id: &str,
        adapter_name: &str,
        adapter: Option<Arc<dyn AgentAdapter>>,
        mode: AgentMode,
        hidden: bool,
        display_name: Option<String>,
    ) -> Result<String, ConfluxError> {
        if let Err(e) = self.host.kill(&PaneId(instance_id.to_string())) {
            log::debug!("respawn: 旧实例 kill 跳过（可能已退出）: instance_id={instance_id}, {e}");
        }
        self.meta.remove(instance_id);
        self.spawn_with_id(
            instance_id.to_string(),
            command,
            args,
            working_dir,
            adapter_id,
            adapter_name,
            adapter,
            mode,
            hidden,
            display_name,
        )
    }

    /// 修改用户自定义别名（display_name 权威在 meta，conmux 侧为 spawn 时快照）。
    pub fn rename_instance(
        &self,
        instance_id: &str,
        display_name: Option<String>,
    ) -> Result<(), ConfluxError> {
        if self
            .meta
            .set_display_name(instance_id, display_name, now_millis())
        {
            Ok(())
        } else {
            Err(not_found(instance_id))
        }
    }

    /// 更新语义状态（AgentStatus 属策略层，只写 meta）。
    pub fn update_status(
        &self,
        instance_id: &str,
        status: AgentStatus,
    ) -> Result<(), ConfluxError> {
        if self.meta.set_status(instance_id, status, now_millis()) {
            Ok(())
        } else {
            Err(not_found(instance_id))
        }
    }

    /// 机制态 + 策略态合并视图。
    pub fn list_instances(&self) -> Vec<AgentInstanceInfo> {
        self.host
            .list_panes()
            .into_iter()
            .map(|pane| {
                let meta = self.meta.get(&pane.pane_id.0);
                let (
                    adapter_name,
                    display_name,
                    status,
                    mode,
                    hidden,
                    last_activity_at,
                    ended_at,
                ) = match meta {
                    Some(m) => (
                        m.adapter_name,
                        m.display_name,
                        m.status,
                        m.mode,
                        m.hidden,
                        m.last_activity_at,
                        m.ended_at,
                    ),
                    // meta 缺失（注册/移除竞态窗口）：机制态兜底，不 panic 不丢项。
                    None => (
                        pane.adapter_id.clone(),
                        pane.display_name.clone(),
                        AgentStatus::Idle,
                        AgentMode::Full,
                        false,
                        pane.created_at,
                        None,
                    ),
                };
                AgentInstanceInfo {
                    instance_id: InstanceId(pane.pane_id.0.clone()),
                    adapter_id: AdapterId(pane.adapter_id),
                    adapter_name,
                    display_name,
                    status,
                    working_dir: pane.working_dir,
                    is_pinned: false, // 由 AppState 层 merge（与 manager 一致）
                    created_at: pane.created_at,
                    last_activity_at,
                    ended_at,
                    mode,
                    hidden,
                }
            })
            .collect()
    }

    pub fn get_instance_state(&self, instance_id: &str) -> Result<AgentStateDetail, ConfluxError> {
        let info = self
            .list_instances()
            .into_iter()
            .find(|i| i.instance_id.0 == instance_id)
            .ok_or_else(|| not_found(instance_id))?;

        let sub_agents = self
            .get_agent_tree(instance_id)
            .map(|tree| {
                fn recurse(node: &AgentTree, out: &mut Vec<SubAgentInfo>) {
                    for child in &node.children {
                        out.push(child.root.clone());
                        recurse(child, out);
                    }
                }
                let mut result = Vec::new();
                recurse(&tree, &mut result);
                result
            })
            .unwrap_or_default();

        Ok(AgentStateDetail {
            instance_id: info.instance_id,
            adapter_id: info.adapter_id,
            adapter_name: info.adapter_name,
            display_name: info.display_name,
            status: info.status,
            working_dir: info.working_dir,
            is_pinned: false, // 由 AppState 层 merge
            created_at: info.created_at,
            last_activity_at: info.last_activity_at,
            ended_at: info.ended_at,
            mode: info.mode,
            hidden: info.hidden,
            sub_agents,
        })
    }

    /// sub-agent 树（共享 parser；shell/无 adapter 实例返回单根节点）。
    pub fn get_agent_tree(&self, instance_id: &str) -> Result<AgentTree, ConfluxError> {
        let meta = self.meta.get(instance_id).ok_or_else(|| not_found(instance_id))?;
        match meta.parser {
            Some(parser_arc) => Ok(parser_arc.lock().get_tree()),
            None => Ok(AgentTree {
                root: SubAgentInfo {
                    id: instance_id.to_string(),
                    name: meta.adapter_name,
                    status: meta.status,
                    parent_id: None,
                },
                children: Vec::new(),
            }),
        }
    }

    /// scrollback 行高水位（V1-core 行级 jump-back：`last_abs_line`）。
    /// pane 不存在或尚无输出（total_bytes==0）→ None（派生退化 Card，不伪造行号）。
    pub fn scrollback_high_water(&self, instance_id: &str) -> Option<u64> {
        self.host
            .pane_state(&PaneId(instance_id.to_string()))
            .ok()
            .filter(|s| s.scrollback.total_bytes > 0)
            .map(|s| s.scrollback.last_abs_line)
    }

    /// scrollback 现时可读行窗（V1-core 消费端降级链：`(first_abs_line, last_abs_line)`）。
    /// pane 不存在 → None（落点降级 FallbackContext）。
    pub fn scrollback_window(&self, instance_id: &str) -> Option<(u64, u64)> {
        self.host
            .pane_state(&PaneId(instance_id.to_string()))
            .ok()
            .map(|s| (s.scrollback.first_abs_line, s.scrollback.last_abs_line))
    }

    /// PTY 历史（base64 原始字节含 ANSI）——替代 manager.get_buffer 路径，
    /// 走 conmux capture（行索引 scrollback，ansi=true 保留原始）。
    /// 返回完整 `CaptureResult`：命令层据 `effectively_full` 写 CaptureDump read 审计
    /// （§3.4 敏感读，复闸 C2）。`All` 范围必然等效全量。
    ///
    /// **重放前导（M2 spike）**：data 前拼接 `mode_preamble`——TUI 的 alt-screen/
    /// 光标隐藏等模态位若已滚出 ring，重新订阅的 xterm 重放会停在错误模式
    /// （文本自愈、模态不自愈，spike 实证）；前导恢复模态基底。全默认态前导为空、零开销。
    pub fn capture_history(&self, instance_id: &str) -> Result<conmux::CaptureResult, ConfluxError> {
        use base64::Engine;
        let pane_id = PaneId(instance_id.to_string());
        let preamble = self.host.mode_preamble(&pane_id)?;
        let mut result = self
            .host
            .capture(CaptureRequest {
                pane_id,
                range: CaptureRange::All,
                ansi: true,
            })
            .map_err(ConfluxError::from)?;
        if !preamble.is_empty() {
            let engine = base64::engine::general_purpose::STANDARD;
            let body = engine.decode(result.data_base64.as_bytes()).map_err(|e| {
                ConfluxError::PtyError {
                    message: format!("capture base64 解码失败: {e}"),
                }
            })?;
            let mut full = preamble;
            full.extend_from_slice(&body);
            result.data_base64 = engine.encode(full);
        }
        Ok(result)
    }

    /// 进程退出检测（前端 ~2s 轮询）。双重检测与 manager 持平：
    /// fast path = meta.exited（PaneExited 事件置位）；slow path = PaneHost::poll_exit
    /// （ConPTY reader 不 EOF 时的兜底，D-2a）。
    pub fn is_process_exited(&self, instance_id: &str) -> Result<bool, ConfluxError> {
        match self.meta.get(instance_id) {
            Some(m) if m.exited => return Ok(true),
            Some(_) => {}
            None => return Err(not_found(instance_id)),
        }
        match self.host.poll_exit(&PaneId(instance_id.to_string())) {
            Ok(Some(_code)) => {
                self.meta.mark_exited(instance_id, now_millis());
                log::info!("is_process_exited: 进程已退出（poll_exit 兜底），instance_id={instance_id}");
                Ok(true)
            }
            Ok(None) => Ok(false),
            Err(conmux::ConmuxError::PaneNotFound { .. }) => Err(not_found(instance_id)),
            Err(e) => {
                log::warn!("is_process_exited: poll_exit 失败（按存活处理）: {e}");
                Ok(false)
            }
        }
    }
}

// ===== 特征测试（自 manager.rs 1:1 移植，cutover §3.5 gate：继续绿 = 无回归）=====
//
// 真实 cmd.exe + 真实 ConPTY（conmux 0.9 + DSR 应答 + JobObject）。
// 纪律：每个 spawn 真实进程的测试结束必 kill。仅 Windows 有意义。
#[cfg(test)]
#[cfg(windows)]
mod characterization_tests {
    use super::*;
    use conmux::{MuxNotify, PaneEventSink};
    use std::sync::Mutex as StdMutex;

    /// 收集 sink（替代 Tauri bridge——特征测试不依赖 AppHandle）。
    struct CollectSink {
        events: Arc<StdMutex<Vec<MuxNotify>>>,
    }
    impl PaneEventSink for CollectSink {
        fn on_notify(&self, notify: MuxNotify) {
            self.events.lock().unwrap().push(notify);
        }
    }

    fn runtime() -> PaneRuntime {
        let meta = Arc::new(InstanceMetaRegistry::new());
        PaneRuntime::new_windows(
            vec![], // 钩子行为由 pty/hooks.rs 单测 + conmux 钩子链测试覆盖
            Arc::new(CollectSink {
                events: Arc::new(StdMutex::new(Vec::new())),
            }),
            meta,
        )
    }

    /// shell 模式 spawn cmd.exe（adapter=None → 无 parser），返回 instance_id。
    fn spawn_shell(rt: &PaneRuntime) -> String {
        rt.spawn(
            "cmd.exe",
            &[],
            ".",
            "shell",
            "Shell",
            None,
            AgentMode::Full,
            false,
            None,
        )
        .expect("spawn cmd.exe 应成功")
    }

    #[test]
    fn spawn_registers_instance_with_expected_fields() {
        let rt = runtime();
        let id = spawn_shell(&rt);

        let list = rt.list_instances();
        assert_eq!(list.len(), 1, "spawn 后应有 1 个实例");
        let info = &list[0];
        assert_eq!(info.instance_id.0, id);
        assert_eq!(info.adapter_id.0, "shell");
        assert_eq!(info.adapter_name, "Shell");
        assert_eq!(info.display_name, None);
        assert_eq!(info.status, AgentStatus::Idle, "初始状态为 Idle");
        assert!(!info.hidden);
        assert_eq!(info.mode, AgentMode::Full);
        assert_eq!(info.ended_at, None, "运行中 ended_at 为 None");

        let st = rt.get_instance_state(&id).expect("state 应存在");
        assert_eq!(st.adapter_id.0, "shell");
        assert_eq!(st.status, AgentStatus::Idle);

        rt.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn spawn_with_id_uses_provided_id() {
        let rt = runtime();
        let id = rt
            .spawn_with_id(
                "char-fixed-id".to_string(),
                "cmd.exe",
                &[],
                ".",
                "shell",
                "Shell",
                None,
                AgentMode::Full,
                false,
                None,
            )
            .expect("spawn_with_id 应成功");
        assert_eq!(id, "char-fixed-id");
        assert!(rt
            .list_instances()
            .iter()
            .any(|i| i.instance_id.0 == "char-fixed-id"));
        rt.kill("char-fixed-id").expect("kill 应成功");
    }

    #[test]
    fn operations_on_unknown_instance_return_not_found() {
        let rt = runtime();
        let unknown = "does-not-exist";
        assert!(matches!(
            rt.inject_stdin(unknown, "x", InjectionSource::UserDirect),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            rt.resize(unknown, 80, 24),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            rt.rename_instance(unknown, Some("a".into())),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            rt.update_status(unknown, AgentStatus::Coding),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            rt.get_instance_state(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            rt.capture_history(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            rt.get_agent_tree(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            rt.kill(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            rt.is_process_exited(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
    }

    #[test]
    fn inject_resize_ok_on_running_instance() {
        let rt = runtime();
        let id = spawn_shell(&rt);
        assert!(rt
            .inject_stdin(&id, "echo hi\r\n", InjectionSource::UserDirect)
            .is_ok());
        assert!(rt.resize(&id, 100, 40).is_ok());
        rt.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn rename_updates_display_name() {
        let rt = runtime();
        let id = spawn_shell(&rt);
        rt.rename_instance(&id, Some("my-alias".into())).unwrap();
        assert_eq!(
            rt.get_instance_state(&id).unwrap().display_name,
            Some("my-alias".into())
        );
        rt.rename_instance(&id, None).unwrap();
        assert_eq!(rt.get_instance_state(&id).unwrap().display_name, None);
        rt.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn update_status_is_reflected_in_state() {
        let rt = runtime();
        let id = spawn_shell(&rt);
        rt.update_status(&id, AgentStatus::Coding).unwrap();
        assert_eq!(
            rt.get_instance_state(&id).unwrap().status,
            AgentStatus::Coding
        );
        rt.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn shell_mode_agent_tree_is_single_root_node() {
        let rt = runtime();
        let id = spawn_shell(&rt);
        let tree = rt.get_agent_tree(&id).unwrap();
        assert_eq!(tree.root.id, id);
        assert_eq!(tree.root.name, "Shell");
        assert!(tree.children.is_empty(), "shell 模式无 sub-agent");
        rt.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn kill_removes_instance_from_registry() {
        let rt = runtime();
        let id = spawn_shell(&rt);
        assert_eq!(rt.list_instances().len(), 1);
        rt.kill(&id).expect("kill 应成功");
        assert_eq!(rt.list_instances().len(), 0, "kill 后实例应移除");
        assert!(matches!(
            rt.get_instance_state(&id),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
    }

    #[test]
    fn respawn_reuses_same_id() {
        let rt = runtime();
        let id = spawn_shell(&rt);
        rt.respawn(
            &id,
            "cmd.exe",
            &[],
            ".",
            "shell",
            "Shell",
            None,
            AgentMode::Full,
            false,
            None,
        )
        .expect("respawn 应成功");
        let list = rt.list_instances();
        assert_eq!(list.len(), 1, "respawn 复用 id，不新增实例");
        assert_eq!(list[0].instance_id.0, id);
        rt.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn reader_thread_captures_output_into_history() {
        // 锁住核心行为：读线程把 PTY 输出写进 scrollback，capture_history 可读回
        //（原 manager 测试断言 OutputBuffer；语义同——历史可回放）。
        use base64::Engine;
        let rt = runtime();
        let id = spawn_shell(&rt);
        rt.inject_stdin(&id, "echo CHARTEST_MARKER\r\n", InjectionSource::UserDirect)
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2500));
        let result = rt.capture_history(&id).expect("history 应可读");
        assert!(result.effectively_full, "All 范围等效全量（触发 read 审计）");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(result.data_base64.as_bytes())
            .expect("base64 应可解");
        let text = String::from_utf8_lossy(&bytes);
        assert!(
            text.contains("CHARTEST_MARKER"),
            "读线程应把回显写进 scrollback，实际:\n{text}"
        );
        rt.kill(&id).expect("kill 应成功");
    }

    /// 超出 manager 特征面的新增断言：poll_exit 兜底（D-2a）——自然退出后
    /// is_process_exited 必须为 true（不依赖 PaneExited 事件是否到达）。
    #[test]
    fn is_process_exited_detects_natural_exit_via_poll() {
        let rt = runtime();
        let id = rt
            .spawn(
                "cmd.exe",
                &["/c".to_string(), "exit 0".to_string()],
                ".",
                "shell",
                "Shell",
                None,
                AgentMode::Full,
                false,
                None,
            )
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2000));
        assert!(
            rt.is_process_exited(&id).expect("查询应成功"),
            "cmd /c exit 0 自然退出后应被检测到"
        );
        rt.kill(&id).expect("kill 应成功（清理）");
    }
}
