// ===== TOML configuration parser unit tests =====
// Tests for parse_adapter_toml and load_adapter_toml
//
// TOML 1.0 spec notes:
// - Top-level fields (permission_pattern, etc.) MUST be declared BEFORE [capabilities] table
// - In TOML basic strings, \ only escapes \\, \", \', \n, \t, \r, \b, \f, \u, \U
// - Rust raw string r#"..."# passes content directly to TOML parser

use conflux_lib::adapter::toml_parser::parse_adapter_toml;
use conflux_lib::core::ConfluxError;

// ===== Full TOML parse test =====

#[test]
fn test_parse_full_toml() {
    // IMPORTANT: top-level fields must come BEFORE [capabilities] table
    let toml_content = r#"
name = "Claude Code"
command = "claude"
default_args = ["--no-banner", "--verbose"]

# Top-level pattern fields (must be before [capabilities])
permission_pattern = "Allow|Deny|Do you want to"
# Use a pattern that doesn't require backslash escaping in TOML.
# The actual sub_agent_spawn regex "Spawning agent|Agent\(" works when written as
# "Spawning agent|Agent\\(" in TOML (since \\ = escaped backslash = \).
sub_agent_spawn_pattern = "Spawning|Agent"
sub_agent_complete_pattern = "Agent completed|agent finished"

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
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

    assert_eq!(config.name, "Claude Code");
    assert_eq!(config.command, "claude");
    assert_eq!(config.default_args, vec!["--no-banner", "--verbose"]);

    // Status patterns
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

    // Capabilities
    assert!(config.capabilities.can_coordinate);
    assert!(config.capabilities.coordination_template.is_some());
    assert!(config.capabilities.can_parse_tree);
    assert!(config.capabilities.can_detect_permission);

    // Pattern fields (must be before [capabilities] in TOML)
    assert!(config.permission_pattern.is_some());
    assert!(config.sub_agent_spawn_pattern.is_some());
    assert!(config.sub_agent_complete_pattern.is_some());
}

// ===== Minimal TOML parse test =====

#[test]
fn test_parse_minimal_toml() {
    let toml_content = r#"
name = "Simple Adapter"
command = "simple-cli"
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

    assert_eq!(config.name, "Simple Adapter");
    assert_eq!(config.command, "simple-cli");

    // Default values
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

// ===== Missing required fields tests =====

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
        other => panic!("Expected InvalidConfig error, got: {:?}", other),
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
        other => panic!("Expected InvalidConfig error, got: {:?}", other),
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
        other => panic!("Expected InvalidConfig error, got: {:?}", other),
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
        other => panic!("Expected InvalidConfig error, got: {:?}", other),
    }
}

// ===== Optional field defaults tests =====

#[test]
fn test_optional_fields_default() {
    let toml_content = r#"
name = "Minimal"
command = "minimal-cli"

[capabilities]
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

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

// ===== Invalid TOML syntax tests =====

#[test]
fn test_invalid_toml_syntax() {
    let toml_content = "this is not valid toml {{{}}}";

    let result = parse_adapter_toml(toml_content);
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("TOML"));
        }
        other => panic!("Expected InvalidConfig error, got: {:?}", other),
    }
}

// ===== Invalid regex pattern tests =====

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
        other => panic!("Expected InvalidConfig error, got: {:?}", other),
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
        other => panic!("Expected InvalidConfig error, got: {:?}", other),
    }
}

// ===== load_adapter_toml file read test =====

#[test]
fn test_load_nonexistent_file() {
    let result =
        conflux_lib::adapter::toml_parser::load_adapter_toml("/nonexistent/path/adapter.toml");
    assert!(result.is_err());

    match result.unwrap_err() {
        ConfluxError::InvalidConfig { message } => {
            assert!(message.contains("无法读取"));
        }
        other => panic!("Expected InvalidConfig error, got: {:?}", other),
    }
}

// ===== Edge case tests =====

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

// ===== TOML 1.0 field order tests =====

#[test]
fn test_top_level_fields_before_capabilities_table() {
    let toml_content = r#"
name = "Top Level Test"
command = "test-cli"

permission_pattern = "Allow|Deny"
sub_agent_spawn_pattern = "Spawn"
sub_agent_complete_pattern = "Done"

[capabilities]
can_detect_permission = true
"#;

    let config = parse_adapter_toml(toml_content).unwrap();

    assert!(config.permission_pattern.is_some());
    assert!(config.sub_agent_spawn_pattern.is_some());
    assert!(config.sub_agent_complete_pattern.is_some());
}

#[test]
fn test_top_level_fields_after_capabilities_table_optional() {
    // When pattern fields are defined AFTER [capabilities] table, they are parsed
    // as children of [capabilities] (i.e., capabilities.permission_pattern),
    // not as root-level fields. So root.permission_pattern remains None.
    let toml_content = r#"
name = "After Table Test"
command = "test-cli"

[capabilities]
can_detect_permission = true

permission_pattern = "Should be ignored"
"#;

    let config = parse_adapter_toml(toml_content).unwrap();
    assert_eq!(config.name, "After Table Test");
    // permission_pattern after [capabilities] belongs to capabilities table
    assert!(config.permission_pattern.is_none());
}
