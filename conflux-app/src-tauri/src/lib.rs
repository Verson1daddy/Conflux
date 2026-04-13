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

pub mod core;
pub mod commands;
pub mod pty;
pub mod adapter;
pub mod orchestration;
pub mod persistence;
pub mod tray;

use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;

use crate::adapter::registry::AdapterRegistry;
use crate::core::{InstanceId, IslandMode, StdinInjectionPolicy};
use crate::orchestration::discussion::DiscussionEngine;
use crate::pty::manager::PtyManager;

/// 全局应用状态——通过 tauri::State 注入到 command handler
///
/// ## 锁获取协议（HIGH-04 修复）
/// 当需要同时持有多把锁时，必须按以下顺序获取，防止死锁：
///   1. `discussion_engine` (RwLock)
///   2. `db` (Mutex)
///   3. `pty_manager` / `adapter_registry`（Arc 内部锁）
/// 任何代码路径不得逆序获取这些锁。
pub struct AppState {
    /// PTY 进程管理器
    pub pty_manager: Arc<PtyManager>,
    /// 适配器注册表
    pub adapter_registry: Arc<RwLock<AdapterRegistry>>,
    /// 当前灵动岛模式
    pub island_mode: RwLock<IslandMode>,
    /// 灵动岛钉选实例 instance_id
    pub pinned_instance: RwLock<Option<InstanceId>>,
    /// 用户收藏的适配器 ID 列表
    pub favorite_adapters: RwLock<Vec<String>>,
    /// 主适配器
    pub primary_adapter: RwLock<Option<String>>,
    /// Agent 实例映射: instance_id -> adapter_id
    pub instance_adapter_map: RwLock<HashMap<String, String>>,
    /// stdin 注入安全策略（附录 B1）
    pub stdin_policy: RwLock<StdinInjectionPolicy>,
    /// 注入速率计数器：记录每次注入的时间戳（秒级），用于速率限制
    pub injection_rate_counter: RwLock<Vec<u64>>,
    /// SQLite 数据库连接（BE-4 持久化层）
    pub db: parking_lot::Mutex<rusqlite::Connection>,
    /// 讨论引擎（BE-4 编排层）
    pub discussion_engine: RwLock<DiscussionEngine>,
}

impl AppState {
    /// 使用指定的数据库路径初始化 AppState
    ///
    /// db_path 应为绝对路径（由 Tauri setup hook 通过 app_data_dir 解析）。
    /// CRIT-01 修复：不再使用相对路径，由 run() 中的 setup hook 传入安全目录。
    pub fn new(db_path: &str) -> Self {
        let db_conn = persistence::schema::init_database(db_path)
            .expect("SQLite 数据库初始化失败");

        Self {
            pty_manager: Arc::new(PtyManager::new()),
            adapter_registry: Arc::new(RwLock::new(AdapterRegistry::new())),
            island_mode: RwLock::new(IslandMode::TopIsland),
            pinned_instance: RwLock::new(None),
            favorite_adapters: RwLock::new(Vec::new()),
            primary_adapter: RwLock::new(None),
            instance_adapter_map: RwLock::new(HashMap::new()),
            stdin_policy: RwLock::new(StdinInjectionPolicy::default()),
            injection_rate_counter: RwLock::new(Vec::new()),
            db: parking_lot::Mutex::new(db_conn),
            discussion_engine: RwLock::new(DiscussionEngine::new()),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // CRIT-01 修复：使用 Tauri app_data_dir 解析安全的数据库路径
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("无法获取应用数据目录");
            std::fs::create_dir_all(&app_data_dir)
                .expect("无法创建应用数据目录");
            let db_path = app_data_dir.join("conflux.db");

            let app_state = AppState::new(
                db_path.to_str().expect("数据库路径包含非 UTF-8 字符"),
            );

            // 注册内置适配器
            {
                let mut registry = app_state.adapter_registry.write();
                adapter::builtin::register_builtins(&mut registry);
            }

            app.manage(app_state);

            // 系统托盘
            if let Err(e) = tray::create_tray(app) {
                eprintln!("系统托盘初始化失败: {e}");
            }

            // DevTools: 按 F12 手动打开（自动打开增加 ~500ms 启动延迟）

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // BE-1: Agent 实例管理
            commands::agent::create_agent_instance,
            commands::agent::destroy_agent_instance,
            commands::agent::list_agent_instances,
            commands::agent::get_agent_state,
            commands::agent::get_agent_tree,
            commands::agent::get_pty_history,
            commands::agent::is_process_exited,
            commands::agent::respawn_agent_instance,
            // BE-1: 窗口管理
            commands::window::open_workspace_window,
            commands::window::focus_agent_card,
            commands::window::switch_island_mode,
            commands::window::get_island_mode,
            // BE-2: PTY 操作
            commands::pty_ops::inject_stdin,
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
            commands::orchestration::set_pinned_instance,
            commands::orchestration::get_pinned_instance,
            // BE-4: 持久化查询
            commands::persistence::list_sessions,
            commands::persistence::query_session_events,
            commands::persistence::list_discussions,
            commands::persistence::get_discussion_messages,
            commands::persistence::save_workspace_layout,
            commands::persistence::load_workspace_layout,
            commands::persistence::auto_pack_layout,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Conflux 失败");
}
