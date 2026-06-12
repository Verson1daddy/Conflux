// Conflux — 模块注册与 Tauri Builder 配置
//
// 模块结构:
//   core/     — 共享类型、事件、错误（CC-2 产出，只读引用）
//   commands/ — Tauri IPC 命令层（BE-1: agent/window, BE-3: adapter）
//   pty/      — PTY 进程管理（BE-2）
//   adapter/  — 框架适配器系统（BE-3）
//
// Tauri Builder 注册流程:
//   1. 初始化全局状态（AppState）
//   2. 注册所有 Tauri commands
//   3. 注册插件
//   4. 启动应用

pub mod adapter;
pub mod commands;
pub mod core;
/// Hook 事件源运行时（A.2 修复 / mux V1-core）：Claude Code PermissionRequest hook
/// → 注意力队列。relay 落盘 + 轮询 + emit；纯逻辑在 core/hook.rs。
pub mod hook_runtime;
pub mod orchestration;
pub mod persistence;
pub mod pty;
pub mod tray;

use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::Manager;

use crate::adapter::registry::AdapterRegistry;
use crate::core::{AgentInstanceInfo, IslandMode, StdinInjectionPolicy};
use crate::orchestration::attention::AttentionQueue;
use crate::orchestration::coordinator::Coordinator;
use crate::orchestration::discussion::DiscussionEngine;
use crate::pty::runtime::PaneRuntime;

/// 全局应用状态——通过 tauri::State 注入到 command handler
///
/// ## 锁获取协议（HIGH-04 修复 / cutover ③ D-1 更新）
/// 当需要同时持有多把锁时，必须按以下顺序获取，防止死锁：
///   1. `discussion_engine` (RwLock)
///   2. `db` (Mutex)
///   3. `pane_runtime` / `adapter_registry`（Arc 内部锁）
/// 任何代码路径不得逆序获取这些锁。注入路径的「panes 表锁 → db（审计钩子）」由
/// conmux D-1a 保证不成立（钩子在表锁外调用）；conflux 侧双保险：**持 db 锁时
/// 不调用 pane_runtime 的任何方法**（create 回滚已修锁作用域）。
pub struct AppState {
    /// Pane 运行时（cutover ③：conmux::PaneHost 门面，替代 PtyManager）
    pub pane_runtime: Arc<PaneRuntime>,
    /// 适配器注册表
    pub adapter_registry: Arc<RwLock<AdapterRegistry>>,
    pub island_window_ready: RwLock<bool>,
    pub pending_compact_show: RwLock<bool>,
    pub island_detail_presentation: RwLock<String>,
    /// 当前灵动岛模式
    pub island_mode: RwLock<IslandMode>,
    /// 钉选实例 ID 集合（多选）
    pub pinned_instances: RwLock<std::collections::HashSet<String>>,
    /// 用户收藏的适配器 ID 列表
    pub favorite_adapters: RwLock<Vec<String>>,
    /// 主适配器
    pub primary_adapter: RwLock<Option<String>>,
    /// Agent 实例映射: instance_id -> adapter_id
    pub instance_adapter_map: RwLock<HashMap<String, String>>,
    /// stdin 注入安全策略（附录 B1）。Arc：与 PolicyHook 共享（cutover ③）。
    pub stdin_policy: Arc<RwLock<StdinInjectionPolicy>>,
    /// 注入速率计数器（MF-3：**per-instance**，避免单 pane 刷注入饿死全体 pane）：
    /// instance_id -> 该实例近 1 分钟注入时间戳（秒级）滑动窗口。
    /// Arc：与 PolicyHook 共享（cutover ③）；destroy 的 C8 清理路径不变。
    pub injection_rate_counter: Arc<RwLock<HashMap<String, Vec<u64>>>>,
    /// SQLite 数据库连接（BE-4 持久化层）。Arc：与 AuditHook 共享同一把锁（cutover ③）。
    pub db: Arc<parking_lot::Mutex<rusqlite::Connection>>,
    /// 讨论引擎（BE-4 编排层）
    pub discussion_engine: RwLock<DiscussionEngine>,
    /// 协调器（C-Δ1 激活）
    pub coordinator: Coordinator,
    /// Coordinator 事件缓冲：最近 10 分钟内的事件（timestamp, event）
    pub recent_events: RwLock<Vec<(u64, crate::core::ConfluxEvent)>>,
    /// 控制面语义层 P2：后端 owned 的唯一注意力队列（ingest/resolve/defer/ignore/restore）
    pub attention_queue: RwLock<AttentionQueue>,
    /// A.2 修复：hook 文件目录（app_data/hooks）。per-instance settings/ndjson 落此。
    pub hook_dir: std::path::PathBuf,
    /// hook relay 脚本绝对路径；`None` = 启动时落盘失败 → hook 感知降级禁用（不阻塞）。
    pub hook_relay_path: Option<std::path::PathBuf>,
    /// per-instance hook watcher 停止信号：instance_id -> stop flag（destroy 时置位）。
    pub hook_watchers: RwLock<HashMap<String, Arc<AtomicBool>>>,
    /// 后台线程统一停止信号（V1-core ticker；app 退出路径置位）。
    pub background_stop: Arc<AtomicBool>,
    /// 审计钩子的类型化句柄（与 PaneRuntime 钩子链同一实例；D3 批审计的
    /// flush_due/flush_all 经此访问——graceful shutdown 必 flush 会签条件）。
    pub audit_hook: Arc<crate::pty::hooks::AuditHook>,
}

impl AppState {
    /// 使用指定的数据库路径初始化 AppState
    ///
    /// db_path 应为绝对路径（由 Tauri setup hook 通过 app_data_dir 解析）。
    /// CRIT-01 修复：不再使用相对路径，由 run() 中的 setup hook 传入安全目录。
    /// cutover ③：需要 AppHandle——MuxEventBridge（PaneEventSink → Tauri emit）构造用。
    pub fn new(db_path: &str, app_handle: tauri::AppHandle) -> Self {
        let db_conn = persistence::schema::init_database(db_path).expect("SQLite 数据库初始化失败");

        // 控制面 P2：从持久层恢复注意力队列（活跃 + 被忽略项）
        let mut attention_queue = AttentionQueue::new();
        if let Err(e) = attention_queue.reload_from_db(&db_conn) {
            log::warn!("注意力队列启动恢复失败（继续以空队列运行）: {e}");
        }

        // A.2 修复：hook 目录 = 数据库同级的 hooks/；落盘 relay 脚本（best-effort，
        // 失败则 hook 感知降级禁用，不阻塞 app 启动）。
        let hook_dir = std::path::Path::new(db_path)
            .parent()
            .map(|p| p.join("hooks"))
            .unwrap_or_else(|| std::path::PathBuf::from("hooks"));
        let hook_relay_path = match hook_runtime::provision_relay(&hook_dir) {
            Ok(p) => Some(p),
            Err(e) => {
                log::warn!("hook relay 落盘失败，hook 感知禁用（PTY 仍正常）: {e}");
                None
            }
        };

        // cutover ③ 装配：db/policy/计数器 Arc 化与钩子共享；meta 与 bridge 共享；
        // PaneHost 由 PaneRuntime 内部经 new_windows 组装（ConPTY + JobObject）。
        let db = Arc::new(parking_lot::Mutex::new(db_conn));
        let stdin_policy = Arc::new(RwLock::new(StdinInjectionPolicy::default()));
        let injection_rate_counter: Arc<RwLock<HashMap<String, Vec<u64>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        let meta = Arc::new(crate::pty::meta::InstanceMetaRegistry::new());
        let bridge = Arc::new(crate::pty::bridge::MuxEventBridge::new(
            app_handle,
            Arc::clone(&meta),
        ));
        // 钩子顺序冻结 [PolicyHook, AuditHook]：policy 先拒 ⇒ 不写 Ok 审计，
        // AuditHook.after 补写 Rejected（语义与原 inject_with_policy 一致）。
        // audit_hook 另存类型化 Arc（D3 flush_due/flush_all 经 ticker / 退出路径访问）。
        let audit_hook = Arc::new(crate::pty::hooks::AuditHook::new(Arc::clone(&db)));
        let hooks: Vec<Arc<dyn conmux::InjectionHook>> = vec![
            Arc::new(crate::pty::hooks::PolicyHook::new(
                Arc::clone(&stdin_policy),
                Arc::clone(&injection_rate_counter),
            )),
            Arc::clone(&audit_hook) as Arc<dyn conmux::InjectionHook>,
        ];
        let pane_runtime = Arc::new(PaneRuntime::new_windows(hooks, bridge, meta));

        Self {
            pane_runtime,
            adapter_registry: Arc::new(RwLock::new(AdapterRegistry::new())),
            island_window_ready: RwLock::new(false),
            pending_compact_show: RwLock::new(false),
            island_detail_presentation: RwLock::new("none".to_string()),
            island_mode: RwLock::new(IslandMode::TopIsland),
            pinned_instances: RwLock::new(std::collections::HashSet::new()),
            favorite_adapters: RwLock::new(Vec::new()),
            primary_adapter: RwLock::new(None),
            instance_adapter_map: RwLock::new(HashMap::new()),
            stdin_policy,
            injection_rate_counter,
            db,
            discussion_engine: RwLock::new(DiscussionEngine::new()),
            coordinator: Coordinator,
            recent_events: RwLock::new(Vec::new()),
            attention_queue: RwLock::new(attention_queue),
            hook_dir,
            hook_relay_path,
            hook_watchers: RwLock::new(HashMap::new()),
            background_stop: Arc::new(AtomicBool::new(false)),
            audit_hook,
        }
    }

    /// 查找适合接收协调指令的 PTY 实例 ID
    ///
    /// 优先级：显式 pin 的存活实例 > primary_adapter 对应的存活实例 > None
    pub fn find_coordination_target(&self) -> Option<String> {
        let primary_adapter = self.primary_adapter.read().clone();
        let pinned_instances = self.pinned_instances.read().clone();
        let instances = self.pane_runtime.list_instances();

        select_coordination_target_candidate(
            &instances,
            primary_adapter.as_deref(),
            &pinned_instances,
            |instance_id| {
                !self
                    .pane_runtime
                    .is_process_exited(instance_id)
                    .unwrap_or(true)
            },
        )
    }
}

fn select_coordination_target_candidate<F>(
    instances: &[AgentInstanceInfo],
    primary_adapter: Option<&str>,
    pinned_instances: &HashSet<String>,
    is_live: F,
) -> Option<String>
where
    F: Fn(&str) -> bool,
{
    instances
        .iter()
        .find(|info| {
            let instance_id = info.instance_id.0.as_str();
            !info.hidden && pinned_instances.contains(instance_id) && is_live(instance_id)
        })
        .map(|info| info.instance_id.0.clone())
        .or_else(|| {
            primary_adapter.and_then(|primary| {
                instances
                    .iter()
                    .find(|info| {
                        let instance_id = info.instance_id.0.as_str();
                        !info.hidden && info.adapter_id.0 == primary && is_live(instance_id)
                    })
                    .map(|info| info.instance_id.0.clone())
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AdapterId, AgentInstanceInfo, AgentMode, AgentStatus, InstanceId};
    use std::collections::HashSet;

    fn instance(id: &str, adapter_id: &str, hidden: bool) -> AgentInstanceInfo {
        AgentInstanceInfo {
            instance_id: InstanceId(id.to_string()),
            adapter_id: AdapterId(adapter_id.to_string()),
            adapter_name: adapter_id.to_string(),
            display_name: None,
            status: AgentStatus::Idle,
            working_dir: "/workspace".to_string(),
            is_pinned: false,
            created_at: 1000,
            last_activity_at: 1000,
            ended_at: None,
            mode: AgentMode::Full,
            hidden,
        }
    }

    #[test]
    fn test_coordination_target_requires_explicit_pin_or_primary_adapter() {
        let instances = vec![instance("plain", "codex", false)];
        let pinned = HashSet::new();

        let target = select_coordination_target_candidate(&instances, None, &pinned, |_| true);

        assert_eq!(target, None);
    }

    #[test]
    fn test_coordination_target_prefers_live_pinned_instance() {
        let instances = vec![
            instance("plain", "codex", false),
            instance("pinned", "claude-code", false),
        ];
        let pinned = HashSet::from(["pinned".to_string()]);

        let target =
            select_coordination_target_candidate(&instances, None, &pinned, |id| id == "pinned");

        assert_eq!(target.as_deref(), Some("pinned"));
    }

    #[test]
    fn test_coordination_target_uses_primary_adapter_without_plain_fallback() {
        let instances = vec![
            instance("plain", "codex", false),
            instance("primary", "claude-code", false),
        ];
        let pinned = HashSet::new();

        let target =
            select_coordination_target_candidate(&instances, Some("claude-code"), &pinned, |_| {
                true
            });

        assert_eq!(target.as_deref(), Some("primary"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(crate::commands::window::should_restore_window_state)
                .skip_initial_state("island")
                .build(),
        )
        .setup(|app| {
            // CRIT-01 修复：使用 Tauri app_data_dir 解析安全的数据库路径
            let app_data_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            std::fs::create_dir_all(&app_data_dir).expect("无法创建应用数据目录");
            let db_path = app_data_dir.join("conflux.db");

            let app_state = AppState::new(
                db_path.to_str().expect("数据库路径包含非 UTF-8 字符"),
                app.handle().clone(),
            );

            // 注册内置适配器
            {
                let mut registry = app_state.adapter_registry.write();
                adapter::builtin::register_builtins(&mut registry);
            }
            {
                let conn = app_state.db.lock();
                let registry = app_state.adapter_registry.read();
                persistence::schema::sync_adapter_configs_from_registry(&conn, &registry)
                    .expect("failed to sync builtin adapter configs");
            }

            app.manage(app_state);

            // V1-core：控制面后台 ticker（250ms：D3 批审计 flush；1s：超时 Expired +
            // defer 提醒复活）
            {
                let state = app.state::<AppState>();
                crate::orchestration::sweeper::spawn_background_ticker(
                    app.handle().clone(),
                    Arc::clone(&state.background_stop),
                );
            }

            // 系统托盘
            if let Err(e) = tray::create_tray(app) {
                eprintln!("系统托盘初始化失败: {e}");
            }

            // DevTools: 按 F12 手动打开（自动打开增加 ~500ms 启动延迟）

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // BE-1: Agent 实例管理
            commands::agent::get_default_working_dir,
            commands::agent::create_agent_instance,
            commands::agent::destroy_agent_instance,
            commands::agent::list_agent_instances,
            commands::agent::get_agent_state,
            commands::agent::get_agent_tree,
            commands::agent::get_pty_history,
            commands::agent::is_process_exited,
            commands::agent::respawn_agent_instance,
            commands::agent::set_agent_mode,
            commands::agent::rename_agent_instance,
            // BE-1: 窗口管理
            commands::window::open_workspace_window,
            commands::window::focus_agent_card,
            commands::window::switch_island_mode,
            commands::window::get_island_mode,
            commands::window::show_island_window,
            commands::window::show_workspace_only,
            commands::window::show_compact_mode_only,
            commands::window::set_island_detail_presentation,
            commands::window::set_top_island_popover_height,
            commands::window::mark_island_window_ready,
            commands::window::debug_island_window_geometry,
            commands::window::hide_island_window,
            commands::window::quit_application,
            // BE-2: PTY 操作
            commands::pty_ops::inject_stdin,
            commands::pty_ops::inject_discussion_message,
            commands::pty_ops::resize_pty,
            commands::pty_ops::respond_to_permission,
            // BE-3: 适配器管理
            commands::adapter::list_adapters,
            commands::adapter::register_adapter,
            commands::adapter::get_adapter_config,
            commands::adapter::unregister_adapter,
            commands::adapter::detect_adapter_auth,
            // BE-4: 编排操作
            commands::orchestration::start_discussion,
            commands::orchestration::send_discussion_message,
            commands::orchestration::end_discussion,
            commands::orchestration::toggle_pin_instance,
            commands::orchestration::get_pinned_instances,
            // 控制面 P2: 注意力队列
            commands::attention::list_attention_items,
            commands::attention::list_deferred_attention_items,
            commands::attention::resolve_attention_item,
            commands::attention::defer_attention_item,
            commands::attention::ignore_attention_item,
            commands::attention::restore_attention_item,
            // 控制面 P3: 待处理交互（PendingInteraction 投影）
            commands::interaction::list_pending_interactions,
            // 控制面 P4: 精确回场对象（JumpBackTarget）
            commands::jumpback::get_jump_back_target,
            // BE-4: 持久化查询
            commands::persistence::list_sessions,
            commands::persistence::query_session_events,
            commands::persistence::list_discussions,
            commands::persistence::get_discussion_messages,
            commands::persistence::save_workspace_layout,
            commands::persistence::load_workspace_layout,
            commands::persistence::auto_pack_layout,
        ])
        .build(tauri::generate_context!())
        .expect("启动 Conflux 失败")
        .run(|app_handle, event| {
            // D3 会签条件：graceful shutdown 必 flush UserDirect 待批审计（退出不留
            // 未审计窗口）；同时停后台 ticker。
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state
                        .background_stop
                        .store(true, std::sync::atomic::Ordering::Relaxed);
                    state.audit_hook.flush_all();
                }
            }
        });
}
