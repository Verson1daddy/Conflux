// ===== Conflux 内置适配器：Aider =====
// Aider AI pair programming 的适配器实现

use async_trait::async_trait;

use crate::adapter::traits::{AgentAdapter, AgentInstance};
use crate::core::{
    AdapterCapabilities, AdapterConfig, AgentStatus, ConfluxError, ConfluxEvent, InstanceId,
    StatusPatterns,
};

pub struct AiderAdapter {
    config: AdapterConfig,
    capabilities: AdapterCapabilities,
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
            sandbox_args: vec![],
            full_args: vec![],
            status_patterns,
            permission_pattern: None,
            sub_agent_spawn_pattern: None,
            sub_agent_complete_pattern: None,
            capabilities: capabilities.clone(),
        };

        Self {
            config,
            capabilities,
        }
    }

    pub fn config(&self) -> &AdapterConfig {
        &self.config
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

    async fn spawn(
        &self,
        _working_dir: &str,
        _args: &[String],
    ) -> Result<Box<dyn AgentInstance>, ConfluxError> {
        todo!("Aider spawn via PtyManager")
    }

    fn parse_output(&self, raw_line: &str) -> Option<ConfluxEvent> {
        let placeholder_id = InstanceId("unknown".to_string());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        if raw_line.contains("Error") || raw_line.contains("Failed") {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Error,
                timestamp: now,
            });
        }
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
