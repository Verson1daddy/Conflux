// ===== Conflux 适配器 TOML 配置解析器 =====
// 将 TOML 配置文件解析为 AdapterConfig 结构体
// 支持内置适配器和用户自定义适配器的配置加载
//
// TOML 配置格式：
// ```toml
// # 适配器基本信息
// name = "Claude Code"          # 必填：适配器显示名称
// command = "claude"             # 必填：启动命令
// default_args = ["--no-banner"] # 可选：默认参数列表
//
// # 状态检测正则模式（均为可选，使用 | 分隔多个匹配模式）
// [status_patterns]
// thinking = "⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|Thinking"
// coding = "Writing|Editing|Creating"
// done = "✓|Done|Completed"
// error = "Error|✗|Failed"
// waiting_permission = "Allow|Deny|approve"
//
// # 能力声明
// [capabilities]
// can_coordinate = true                          # 可选，默认 false
// coordination_template = "You are coordinating..." # 可选
// can_parse_tree = true                           # 可选，默认 false
// can_detect_permission = true                    # 可选，默认 false
//
// # 额外检测模式（顶层，均为可选）
// permission_pattern = "Allow|Deny|Do you want to"
// sub_agent_spawn_pattern = "Spawning agent|Agent\\("
// sub_agent_complete_pattern = "Agent completed|agent finished"
// ```

use serde::Deserialize;

use crate::core::{AdapterCapabilities, AdapterConfig, ConfluxError, StatusPatterns};

/// TOML 文件根结构（中间表示，用于反序列化）
#[derive(Debug, Deserialize)]
struct TomlRoot {
    /// 适配器名称（必填）
    name: Option<String>,
    /// 启动命令（必填）
    command: Option<String>,
    /// 默认参数（可选）
    default_args: Option<Vec<String>>,
    /// 状态检测模式（可选）
    status_patterns: Option<TomlStatusPatterns>,
    /// 能力声明（可选）
    capabilities: Option<TomlCapabilities>,
    /// 权限请求检测正则（可选）
    permission_pattern: Option<String>,
    /// Sub-agent 生成检测正则（可选）
    sub_agent_spawn_pattern: Option<String>,
    /// Sub-agent 完成检测正则（可选）
    sub_agent_complete_pattern: Option<String>,
}

/// TOML 状态检测模式（中间表示）
#[derive(Debug, Deserialize)]
struct TomlStatusPatterns {
    thinking: Option<String>,
    coding: Option<String>,
    done: Option<String>,
    error: Option<String>,
    waiting_permission: Option<String>,
}

/// TOML 能力声明（中间表示）
#[derive(Debug, Deserialize)]
struct TomlCapabilities {
    can_coordinate: Option<bool>,
    coordination_template: Option<String>,
    can_parse_tree: Option<bool>,
    can_detect_permission: Option<bool>,
}

/// 解析 TOML 适配器配置内容
/// content: TOML 格式的字符串内容
/// 返回解析后的 AdapterConfig 或错误
pub fn parse_adapter_toml(content: &str) -> Result<AdapterConfig, ConfluxError> {
    let root: TomlRoot =
        toml::from_str(content).map_err(|e| ConfluxError::InvalidConfig {
            message: format!("TOML 解析失败: {}", e),
        })?;

    // 验证必填字段
    let name = root.name.ok_or_else(|| ConfluxError::InvalidConfig {
        message: "缺少必填字段 'name'".to_string(),
    })?;

    if name.trim().is_empty() {
        return Err(ConfluxError::InvalidConfig {
            message: "'name' 字段不能为空".to_string(),
        });
    }

    let command = root.command.ok_or_else(|| ConfluxError::InvalidConfig {
        message: "缺少必填字段 'command'".to_string(),
    })?;

    if command.trim().is_empty() {
        return Err(ConfluxError::InvalidConfig {
            message: "'command' 字段不能为空".to_string(),
        });
    }

    // 解析状态检测模式（所有字段可选）
    let status_patterns = match root.status_patterns {
        Some(sp) => StatusPatterns {
            thinking: sp.thinking,
            coding: sp.coding,
            done: sp.done,
            error: sp.error,
            waiting_permission: sp.waiting_permission,
        },
        None => StatusPatterns {
            thinking: None,
            coding: None,
            done: None,
            error: None,
            waiting_permission: None,
        },
    };

    // 验证正则模式是否合法（如果提供了的话）
    validate_optional_regex(&status_patterns.thinking, "status_patterns.thinking")?;
    validate_optional_regex(&status_patterns.coding, "status_patterns.coding")?;
    validate_optional_regex(&status_patterns.done, "status_patterns.done")?;
    validate_optional_regex(&status_patterns.error, "status_patterns.error")?;
    validate_optional_regex(
        &status_patterns.waiting_permission,
        "status_patterns.waiting_permission",
    )?;
    validate_optional_regex(&root.permission_pattern, "permission_pattern")?;
    validate_optional_regex(&root.sub_agent_spawn_pattern, "sub_agent_spawn_pattern")?;
    validate_optional_regex(
        &root.sub_agent_complete_pattern,
        "sub_agent_complete_pattern",
    )?;

    // 解析能力声明（所有字段可选，有默认值）
    let capabilities = match root.capabilities {
        Some(cap) => AdapterCapabilities {
            can_coordinate: cap.can_coordinate.unwrap_or(false),
            coordination_template: cap.coordination_template,
            can_parse_tree: cap.can_parse_tree.unwrap_or(false),
            can_detect_permission: cap.can_detect_permission.unwrap_or(false),
        },
        None => AdapterCapabilities {
            can_coordinate: false,
            coordination_template: None,
            can_parse_tree: false,
            can_detect_permission: false,
        },
    };

    Ok(AdapterConfig {
        name,
        command,
        default_args: root.default_args.unwrap_or_default(),
        status_patterns,
        permission_pattern: root.permission_pattern,
        sub_agent_spawn_pattern: root.sub_agent_spawn_pattern,
        sub_agent_complete_pattern: root.sub_agent_complete_pattern,
        capabilities,
    })
}

/// 从文件路径读取并解析 TOML 适配器配置
///
/// 安全限制（RED TEAM HIGH-03）：
/// - 路径必须以 .toml 扩展名结尾
/// - 路径经过规范化后不得包含 ".." 路径遍历
/// - 仅读取 TOML 格式文件，错误消息不泄露文件内容
pub fn load_adapter_toml(path: &str) -> Result<AdapterConfig, ConfluxError> {
    // 安全检查：扩展名必须是 .toml
    if !path.to_lowercase().ends_with(".toml") {
        return Err(ConfluxError::InvalidConfig {
            message: "适配器配置文件必须是 .toml 格式".to_string(),
        });
    }

    // 安全检查：禁止路径遍历
    let canonical = std::path::Path::new(path);
    let path_str = canonical.to_string_lossy();
    if path_str.contains("..") {
        return Err(ConfluxError::InvalidConfig {
            message: "适配器配置路径不允许包含 '..'".to_string(),
        });
    }

    let content = std::fs::read_to_string(path).map_err(|e| ConfluxError::InvalidConfig {
        message: format!("无法读取配置文件: {}", e),
    })?;

    parse_adapter_toml(&content)
}

/// 验证可选的正则模式是否合法
fn validate_optional_regex(
    pattern: &Option<String>,
    field_name: &str,
) -> Result<(), ConfluxError> {
    if let Some(p) = pattern {
        regex::Regex::new(p).map_err(|e| ConfluxError::InvalidConfig {
            message: format!("正则模式无效 ({}): '{}' — {}", field_name, p, e),
        })?;
    }
    Ok(())
}
