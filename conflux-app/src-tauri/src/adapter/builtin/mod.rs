// ===== Conflux 内置适配器模块 =====
// 包含所有预置的 CLI 框架适配器
// 当前版本包含：Claude Code, Codex, Aider, OpenCode

pub mod aider;
pub mod claude_code;
pub mod codex;
pub mod opencode;

use std::sync::Arc;

use crate::adapter::registry::AdapterRegistry;

use self::aider::AiderAdapter;
use self::claude_code::ClaudeCodeAdapter;
use self::codex::CodexAdapter;
use self::opencode::OpenCodeAdapter;

/// 注册所有内置适配器到注册表
/// 在应用启动时由 lib.rs 调用
pub fn register_builtins(registry: &mut AdapterRegistry) {
    // Claude Code 适配器
    let claude_adapter = ClaudeCodeAdapter::new();
    let config = claude_adapter.config().clone();
    registry.register("claude-code", Arc::new(claude_adapter), config, true);

    // Codex 适配器
    let codex_adapter = CodexAdapter::new();
    let config = codex_adapter.config().clone();
    registry.register("codex", Arc::new(codex_adapter), config, true);

    // Aider 适配器
    let aider_adapter = AiderAdapter::new();
    let config = aider_adapter.config().clone();
    registry.register("aider", Arc::new(aider_adapter), config, true);

    // OpenCode 适配器
    let opencode_adapter = OpenCodeAdapter::new();
    let config = opencode_adapter.config().clone();
    registry.register("opencode", Arc::new(opencode_adapter), config, true);

    log::info!("已注册 {} 个内置适配器", registry.count());
}
