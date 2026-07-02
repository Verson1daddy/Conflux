// ===== Conflux 内置适配器：Aider =====
// Aider AI pair programming 的适配器实现

use async_trait::async_trait;
use regex::Regex;

use crate::adapter::traits::AgentAdapter;
use crate::core::{
    AdapterCapabilities, AdapterConfig, AgentStatus, ConfluxEvent, InstanceId,
    StatusPatterns,
};

/// Aider 预编译正则模式集合
struct AiderPatterns {
    thinking: Regex,
    coding: Regex,
    done: Regex,
    error: Regex,
}

pub struct AiderAdapter {
    config: AdapterConfig,
    capabilities: AdapterCapabilities,
    /// 预编译的正则模式
    patterns: AiderPatterns,
}

impl AiderAdapter {
    pub fn new() -> Self {
        let capabilities = AdapterCapabilities {
            can_coordinate: false,
            coordination_template: None,
            can_parse_tree: false,
            can_detect_permission: false,
        };

        let status_patterns = StatusPatterns {
            thinking: Some(r"Thinking|\.\.\.".to_string()),
            coding: Some(r"Editing|Applied|Commit".to_string()),
            done: Some(r"Done|Applied edit".to_string()),
            error: Some(r"Error|Can't|Failed".to_string()),
            waiting_permission: None,
        };

        let config = AdapterConfig {
            name: "Aider".to_string(),
            command: "aider".to_string(),
            default_args: vec![],
            // sandbox/full 为空 ⇒ AgentMode 切换只是标签（见 claude_code.rs D-0702-002 登记）。
            sandbox_args: vec![],
            full_args: vec![],
            status_patterns,
            permission_pattern: None,
            sub_agent_spawn_pattern: None,
            sub_agent_complete_pattern: None,
            capabilities: capabilities.clone(),
        };

        // 预编译所有正则模式（case-insensitive）
        let patterns = AiderPatterns {
            thinking: Regex::new(r"(?i)Thinking\.\.\.|^> ")
                .expect("内置 aider thinking 正则编译失败"),
            coding: Regex::new(r"(?i)───|Editing|^\+[^+]|^-[^-]")
                .expect("内置 aider coding 正则编译失败"),
            done: Regex::new(r"(?i)Tokens:|Applied edit|^Commit ")
                .expect("内置 aider done 正则编译失败"),
            error: Regex::new(r"(?i)Error|Failed|Can't|Unable")
                .expect("内置 aider error 正则编译失败"),
        };

        Self {
            config,
            capabilities,
            patterns,
        }
    }

    pub fn config(&self) -> &AdapterConfig {
        &self.config
    }

    /// 获取当前时间戳（毫秒）
    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }
}

#[async_trait]
impl AgentAdapter for AiderAdapter {
    fn name(&self) -> &str {
        "aider"
    }

    fn capabilities(&self) -> &AdapterCapabilities {
        &self.capabilities
    }

    fn parse_output(&self, raw_line: &str) -> Option<ConfluxEvent> {
        let placeholder_id = InstanceId("unknown".to_string());
        let now = Self::now_ms();

        // 检测优先级（从高到低）：error > coding > thinking > done

        // 1. 错误状态检测
        if self.patterns.error.is_match(raw_line) {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Error,
                timestamp: now,
            });
        }

        // 2. 编码状态检测
        if self.patterns.coding.is_match(raw_line) {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Coding,
                timestamp: now,
            });
        }

        // 3. 思考状态检测
        if self.patterns.thinking.is_match(raw_line) {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Thinking,
                timestamp: now,
            });
        }

        // 4. 完成状态检测
        if self.patterns.done.is_match(raw_line) {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Done,
                timestamp: now,
            });
        }

        // 无匹配——普通输出行
        None
    }

    async fn detect_auth(&self) -> Result<(), String> {
        // Aider supports multiple LLM providers; check common API keys
        let has_openai = std::env::var("OPENAI_API_KEY").is_ok();
        let has_anthropic = std::env::var("ANTHROPIC_API_KEY").is_ok();

        if has_openai || has_anthropic {
            // Has at least one API key, check if binary exists
            let mut cmd = std::process::Command::new("aider");
            cmd.arg("--version")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            match cmd.spawn() {
                Ok(child) => match child.wait_with_output() {
                    Ok(output) if output.status.success() => Ok(()),
                    _ => Err("Aider binary found but returned an error.".to_string()),
                },
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    Err("Aider not found. Install it first: pip install aider-chat".to_string())
                }
                Err(e) => Err(format!("Failed to check Aider: {}", e)),
            }
        } else {
            // No API key — check binary first to give better error
            let mut cmd = std::process::Command::new("aider");
            cmd.arg("--version")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            match cmd.spawn() {
                Ok(_) => Err(
                    "Aider is installed but no API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY."
                        .to_string(),
                ),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    Err("Aider not found. Install it first: pip install aider-chat".to_string())
                }
                Err(e) => Err(format!("Failed to check Aider: {}", e)),
            }
        }
    }
}
