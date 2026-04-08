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

use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

use crate::adapter::registry::AdapterRegistry;
use crate::core::{InstanceId, IslandMode, StdinInjectionPolicy};
use crate::pty::manager::PtyManager;

/// 全局应用状态——通过 tauri::State 注入到 command handler
pub struct AppState {
    /// PTY 进程管理器
    pub pty_manager: Arc<PtyManager>,
    /// 适配器注册表
    pub adapter_registry: Arc<RwLock<AdapterRegistry>>,
    /// 当前灵动岛模式
    pub island_mode: RwLock<IslandMode>,
    /// 灵动岛主框架 instance_id
    pub primary_framework: RwLock<Option<InstanceId>>,
    /// Agent 实例映射: instance_id -> adapter_id
    pub instance_adapter_map: RwLock<HashMap<String, String>>,
    /// stdin 注入安全策略（附录 B1）
    pub stdin_policy: RwLock<StdinInjectionPolicy>,
    /// 注入速率计数器：记录每次注入的时间戳（秒级），用于速率限制
    pub injection_rate_counter: RwLock<Vec<u64>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pty_manager: Arc::new(PtyManager::new()),
            adapter_registry: Arc::new(RwLock::new(AdapterRegistry::new())),
            island_mode: RwLock::new(IslandMode::TopIsland),
            primary_framework: RwLock::new(None),
            instance_adapter_map: RwLock::new(HashMap::new()),
            stdin_policy: RwLock::new(StdinInjectionPolicy::default()),
            injection_rate_counter: RwLock::new(Vec::new()),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let app_state = AppState::new();

    // 注册内置适配器
    {
        let mut registry = app_state.adapter_registry.write();
        adapter::builtin::register_builtins(&mut registry);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // BE-1: Agent 实例管理
            commands::agent::create_agent_instance,
            commands::agent::destroy_agent_instance,
            commands::agent::list_agent_instances,
            commands::agent::get_agent_state,
            commands::agent::get_agent_tree,
            // BE-1: 窗口管理
            commands::window::open_workspace_window,
            commands::window::focus_agent_card,
            commands::window::switch_island_mode,
            commands::window::get_island_mode,
            // BE-2: PTY 操作
            commands::pty_ops::inject_stdin,
            commands::pty_ops::resize_pty,
            // BE-3: 适配器管理
            commands::adapter::list_adapters,
            commands::adapter::register_adapter,
            commands::adapter::get_adapter_config,
            commands::adapter::unregister_adapter,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Conflux 失败");
}
