// ===== Conflux 内置适配器模块 =====
// 包含所有预置的 CLI 框架适配器
// 当前版本包含：Claude Code

pub mod claude_code;

use std::sync::Arc;

use crate::adapter::registry::AdapterRegistry;

use self::claude_code::ClaudeCodeAdapter;

/// 注册所有内置适配器到注册表
/// 在应用启动时由 lib.rs 调用
pub fn register_builtins(registry: &mut AdapterRegistry) {
    // Claude Code 适配器
    let claude_adapter = ClaudeCodeAdapter::new();
    let config = claude_adapter.config().clone();
    registry.register("claude-code", Arc::new(claude_adapter), config, true);

    log::info!("已注册 {} 个内置适配器", registry.count());
}
