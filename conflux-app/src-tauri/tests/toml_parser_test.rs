// ===== TOML 配置解析器单元测试 =====
// 测试 parse_adapter_toml 和 load_adapter_toml 的各种场景

use conflux_lib::adapter::toml_parser::parse_adapter_toml;
use conflux_lib::core::ConfluxError;

// ===== 完整 TOML 解析测试 =====

#[test]
fn test_parse_full_toml() {
    let toml_content = r#"
name = "Claude Code"
command = "claude"
default_args = ["--no-banner", "--verbose"]

[status_patterns]
thinking = "⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|Thinking"
coding = "Writing|Editing|Creating"
done = "✓|Done|Completed"
error = "Error|✗|Failed"
waiting_permission = "Allow|Deny|approve"

[capabilities]
can_coordinate = true
coordination_template = "You are coordinating..."
can_parse_tree = true
can_detect_permission = true

permission_pattern = "Allow|Deny|Do you want to"
sub_agent_spawn_pattern = "Spawning agent|Agent\\("
sub_agent_complete_pattern = "Agent completed|agent finished"
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

    assert_eq!(config.name, "Claude Code");
    assert_eq!(config.command, "claude");
    assert_eq!(config.default_args, vec!["--no-banner", "--verbose"]);

    // 状态检测模式
    assert!(config.status_patterns.thinking.is_some());
    assert!(config
        .status_patterns
        .thinking
        .as_ref()
        .unwrap()
        .contains("Thinking"));
    assert!(config.status_patterns.coding.is_some());
    assert!(config.status_patterns.done.is_some());
    assert!(config.status_patterns.error.is_some());
    assert!(config.status_patterns.waiting_permission.is_some());

    // 能力声明
    assert!(config.capabilities.can_coordinate);
    assert!(config.capabilities.coordination_template.is_some());
    assert!(config.capabilities.can_parse_tree);
    assert!(config.capabilities.can_detect_permission);

    // 额外检测模式
    assert!(config.permission_pattern.is_some());
    assert!(config.sub_agent_spawn_pattern.is_some());
    assert!(config.sub_agent_complete_pattern.is_some());
}

// ===== 最小 TOML 解析测试 =====

#[test]
fn test_parse_minimal_toml() {
    let toml_content = r#"
name = "Simple Adapter"
command = "simple-cli"
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

    assert_eq!(config.name, "Simple Adapter");
    assert_eq!(config.command, "simple-cli");

    // 默认值验证
    assert!(config.default_args.is_empty());
    assert!(config.status_patterns.thinking.is_none());
    assert!(config.status_patterns.coding.is_none());
    assert!(config.status_patterns.done.is_none());
    assert!(config.status_patterns.error.is_none());
    assert!(config.status_patterns.waiting_permission.is_none());
    assert!(!config.capabilities.can_coordinate);
    assert!(config.capabilities.coordination_template.is_none());
    assert!(!config.capabilities.can_parse_tree);
    assert!(!config.capabilities.can_detect_permission);
    assert!(config.permission_pattern.is_none());
    assert!(config.sub_agent_spawn_pattern.is_none());
    assert!(config.sub_agent_complete_pattern.is_none());
}

// ===== 缺少必填字段测试 =====

#[test]
fn test_missing_name() {
    let toml_content = r#"
command = "some-cli"
"#;

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("name"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

#[test]
fn test_missing_command() {
    let toml_content = r#"
name = "Test Adapter"
"#;

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("command"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

#[test]
fn test_empty_name() {
    let toml_content = r#"
name = ""
command = "some-cli"
"#;

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("name"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

#[test]
fn test_empty_command() {
    let toml_content = r#"
name = "Test"
command = "  "
"#;

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("command"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

// ===== 可选字段默认值测试 =====

#[test]
fn test_optional_fields_default() {
    let toml_content = r#"
name = "Minimal"
command = "minimal-cli"

[capabilities]
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

    // capabilities 中的布尔字段应默认为 false
    assert!(!config.capabilities.can_coordinate);
    assert!(!config.capabilities.can_parse_tree);
    assert!(!config.capabilities.can_detect_permission);
    assert!(config.capabilities.coordination_template.is_none());
}

#[test]
fn test_partial_capabilities() {
    let toml_content = r#"
name = "Partial"
command = "partial-cli"

[capabilities]
can_coordinate = true
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

    assert!(config.capabilities.can_coordinate);
    // 未指定的字段应为默认值
    assert!(!config.capabilities.can_parse_tree);
    assert!(!config.capabilities.can_detect_permission);
}

#[test]
fn test_partial_status_patterns() {
    let toml_content = r#"
name = "Partial Patterns"
command = "test-cli"

[status_patterns]
thinking = "Thinking"
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

    assert_eq!(
        config.status_patterns.thinking.as_deref(),
        Some("Thinking")
    );
    assert!(config.status_patterns.coding.is_none());
    assert!(config.status_patterns.done.is_none());
    assert!(config.status_patterns.error.is_none());
    assert!(config.status_patterns.waiting_permission.is_none());
}

// ===== 无效 TOML 语法测试 =====

#[test]
fn test_invalid_toml_syntax() {
    let toml_content = "this is not valid toml {{{}}}";

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("TOML"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

// ===== 无效正则模式测试 =====

#[test]
fn test_invalid_regex_in_status_patterns() {
    let toml_content = r#"
name = "Bad Regex"
command = "test-cli"

[status_patterns]
thinking = "[invalid regex"
"#;

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("正则模式无效"));
            assert!(message.contains("thinking"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

#[test]
fn test_invalid_regex_in_permission_pattern() {
    let toml_content = r#"
name = "Bad Regex"
command = "test-cli"
permission_pattern = "(unclosed"
"#;

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("正则模式无效"));
            assert!(message.contains("permission_pattern"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

// ===== load_adapter_toml 文件读取测试 =====

#[test]
fn test_load_nonexistent_file() {
    let result =
        conflux_lib::adapter::toml_parser::load_adapter_toml("/nonexistent/path/adapter.toml");
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("无法读取"));
        }
        other => panic!("期望 InvalidConfig 错误，实际得到: {:?}", other),
    }
}

// ===== 边界情况测试 =====

#[test]
fn test_empty_default_args() {
    let toml_content = r#"
name = "Empty Args"
command = "test-cli"
default_args = []
"#;

    let config = parse_adapter_toml(toml_content).unwrap();
    assert!(config.default_args.is_empty());
}

#[test]
fn test_unicode_in_patterns() {
    let toml_content = r#"
name = "Unicode Adapter"
command = "unicode-cli"

[status_patterns]
thinking = "⠋|⠙|⠹|思考中"
done = "✓|完成|✅"
"#;

    let config = parse_adapter_toml(toml_content).unwrap();
    assert!(config.status_patterns.thinking.is_some());
    assert!(config.status_patterns.done.is_some());
}

#[test]
fn test_whitespace_in_name() {
    let toml_content = r#"
name = "  "
command = "test-cli"
"#;

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());
}
