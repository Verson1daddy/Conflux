// ===== 适配器注册表单元测试 =====
// 测试 AdapterRegistry 的注册、注销、查询、列表功能

use std::sync::Arc;

use async_trait::async_trait;
use conflux_lib::adapter::registry::AdapterRegistry;
use conflux_lib::adapter::traits::{AgentAdapter, AgentInstance};
use conflux_lib::core::{
    AdapterCapabilities, AdapterConfig, ConfluxError, ConfluxEvent, StatusPatterns,
};

/// 测试用 mock 适配器
struct MockAdapter {
    adapter_name: String,
    caps: AdapterCapabilities,
}

impl MockAdapter {
    fn new(name: &str) -> Self {
        Self {
            adapter_name: name.to_string(),
            caps: AdapterCapabilities {
                can_coordinate: false,
                coordination_template: None,
                can_parse_tree: false,
                can_detect_permission: false,
            },
        }
    }
}

#[async_trait]
impl AgentAdapter for MockAdapter {
    fn name(&self) -> &str {
        &self.adapter_name
    }

    fn capabilities(&self) -> &AdapterCapabilities {
        &self.caps
    }

    async fn spawn(
        &self,
        _working_dir: &str,
        _args: &[String],
    ) -> Result<Box<dyn AgentInstance>, ConfluxError> {
        Err(ConfluxError::PtyError {
            message: "mock adapter does not support spawn".to_string(),
        })
    }

    fn parse_output(&self, _raw_line: &str) -> Option<ConfluxEvent> {
        None
    }
}

fn make_config(name: &str) -> AdapterConfig {
    AdapterConfig {
        name: name.to_string(),
        command: "test-cmd".to_string(),
        default_args: vec![],
        sandbox_args: vec![],
        full_args: vec![],
        status_patterns: StatusPatterns {
            thinking: None,
            coding: None,
            done: None,
            error: None,
            waiting_permission: None,
        },
        permission_pattern: None,
        sub_agent_spawn_pattern: None,
        sub_agent_complete_pattern: None,
        capabilities: AdapterCapabilities {
            can_coordinate: false,
            coordination_template: None,
            can_parse_tree: false,
            can_detect_permission: false,
        },
    }
}

// ===== 注册测试 =====

#[test]
fn test_register_and_get() {
    let mut registry = AdapterRegistry::new();
    let adapter = Arc::new(MockAdapter::new("test-adapter"));
    let config = make_config("Test Adapter");

    registry.register("test-adapter", adapter, config, false);

    // 验证可以通过 ID 获取
    assert!(registry.get("test-adapter").is_some());
    assert_eq!(registry.get("test-adapter").unwrap().name(), "test-adapter");
}

#[test]
fn test_register_builtin() {
    let mut registry = AdapterRegistry::new();
    let adapter = Arc::new(MockAdapter::new("builtin-adapter"));
    let config = make_config("Builtin Adapter");

    registry.register("builtin-adapter", adapter, config, true);

    assert!(registry.is_builtin("builtin-adapter"));
    assert!(!registry.is_builtin("nonexistent"));
}

#[test]
fn test_get_nonexistent() {
    let registry = AdapterRegistry::new();
    assert!(registry.get("nonexistent").is_none());
}

// ===== 注销测试 =====

#[test]
fn test_unregister_custom() {
    let mut registry = AdapterRegistry::new();
    let adapter = Arc::new(MockAdapter::new("custom"));
    let config = make_config("Custom");

    registry.register("custom", adapter, config, false);
    assert!(registry.get("custom").is_some());

    let result = registry.unregister("custom");
    assert!(result.is_ok());
    assert!(registry.get("custom").is_none());
}

#[test]
fn test_cannot_unregister_builtin() {
    let mut registry = AdapterRegistry::new();
    let adapter = Arc::new(MockAdapter::new("builtin"));
    let config = make_config("Builtin");

    registry.register("builtin", adapter, config, true);

    let result = registry.unregister("builtin");
    assert!(result.is_err());

    // 验证仍然存在
    assert!(registry.get("builtin").is_some());

    // 验证错误类型
    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("内置适配器"));
            assert!(message.contains("builtin"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

#[test]
fn test_unregister_nonexistent() {
    let mut registry = AdapterRegistry::new();
    let result = registry.unregister("nonexistent");
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::AdapterNotFound { adapter_id } => {
            assert_eq!(adapter_id, "nonexistent");
        }
        other => panic!("期望 AdapterNotFound 错误，实际得到: {:?}", other),
    }
}

// ===== 配置查询测试 =====

#[test]
fn test_get_config() {
    let mut registry = AdapterRegistry::new();
    let adapter = Arc::new(MockAdapter::new("test"));
    let config = make_config("Test Config");

    registry.register("test", adapter, config, false);

    let retrieved = registry.get_config("test");
    assert!(retrieved.is_some());
    assert_eq!(retrieved.unwrap().name, "Test Config");
    assert_eq!(retrieved.unwrap().command, "test-cmd");
}

#[test]
fn test_get_config_nonexistent() {
    let registry = AdapterRegistry::new();
    assert!(registry.get_config("nonexistent").is_none());
}

// ===== 列表测试 =====

#[test]
fn test_list_empty() {
    let registry = AdapterRegistry::new();
    let list = registry.list();
    assert!(list.is_empty());
}

#[test]
fn test_list_multiple() {
    let mut registry = AdapterRegistry::new();

    // 注册一个内置和一个自定义
    let builtin_adapter = Arc::new(MockAdapter::new("builtin"));
    let builtin_config = make_config("Builtin");
    registry.register("builtin", builtin_adapter, builtin_config, true);

    let custom_adapter = Arc::new(MockAdapter::new("custom"));
    let custom_config = make_config("Custom");
    registry.register("custom", custom_adapter, custom_config, false);

    let list = registry.list();
    assert_eq!(list.len(), 2);

    // 找到内置适配器并验证
    let builtin_info = list.iter().find(|i| i.id.0 == "builtin");
    assert!(builtin_info.is_some());
    assert!(builtin_info.unwrap().is_builtin);

    // 找到自定义适配器并验证
    let custom_info = list.iter().find(|i| i.id.0 == "custom");
    assert!(custom_info.is_some());
    assert!(!custom_info.unwrap().is_builtin);
}

// ===== count 测试 =====

#[test]
fn test_count() {
    let mut registry = AdapterRegistry::new();
    assert_eq!(registry.count(), 0);

    let adapter = Arc::new(MockAdapter::new("a"));
    let config = make_config("A");
    registry.register("a", adapter, config, false);
    assert_eq!(registry.count(), 1);

    let adapter2 = Arc::new(MockAdapter::new("b"));
    let config2 = make_config("B");
    registry.register("b", adapter2, config2, true);
    assert_eq!(registry.count(), 2);

    registry.unregister("a").unwrap();
    assert_eq!(registry.count(), 1);
}

// ===== Default trait 测试 =====

#[test]
fn test_default() {
    let registry = AdapterRegistry::default();
    assert_eq!(registry.count(), 0);
    assert!(registry.list().is_empty());
}

// ===== register_builtins 集成测试 =====

#[test]
fn test_register_builtins() {
    let mut registry = AdapterRegistry::new();
    conflux_lib::adapter::builtin::register_builtins(&mut registry);

    // 应该至少注册了 claude-code
    assert!(registry.get("claude-code").is_some());
    assert!(registry.is_builtin("claude-code"));

    let config = registry.get_config("claude-code").unwrap();
    assert_eq!(config.name, "Claude Code");
    assert_eq!(config.command, "claude");
    assert!(config.capabilities.can_coordinate);
    assert!(config.capabilities.can_parse_tree);
    assert!(config.capabilities.can_detect_permission);
}
