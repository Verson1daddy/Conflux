// ===== Conflux 内置适配器：Codex CLI =====
// OpenAI Codex CLI 框架的适配器实现

use async_trait::async_trait;

use crate::adapter::traits::{AgentAdapter, AgentInstance};
use crate::core::{
    AdapterCapabilities, AdapterConfig, AgentStatus, ConfluxError, ConfluxEvent, InstanceId,
    StatusPatterns,
};

pub struct CodexAdapter {
    config: AdapterConfig,
    capabilities: AdapterCapabilities,
}

impl CodexAdapter {
    pub fn new() -> Self {
        let capabilities = AdapterCapabilities {
            can_coordinate: false,
            coordination_template: None,
            can_parse_tree: false,
            can_detect_permission: true,
        };

        let status_patterns = StatusPatterns {
            thinking: Some(r"Thinking|Reasoning".to_string()),
            coding: Some(r"Writing|Editing|Applying".to_string()),
            done: Some(r"✓|Done|Completed".to_string()),
            error: Some(r"Error|✗|Failed".to_string()),
            waiting_permission: Some(r"approve|Allow|Deny".to_string()),
        };

        let config = AdapterConfig {
            name: "Codex".to_string(),
            command: "codex".to_string(),
            default_args: vec![],
            status_patterns,
            permission_pattern: Some(r"approve|Allow|Deny".to_string()),
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
impl AgentAdapter for CodexAdapter {
    fn name(&self) -> &str {
        "codex"
    }

    fn capabilities(&self) -> &AdapterCapabilities {
        &self.capabilities
    }

    async fn spawn(
        &self,
        _working_dir: &str,
        _args: &[String],
    ) -> Result<Box<dyn AgentInstance>, ConfluxError> {
        todo!("Codex spawn via PtyManager")
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
        if raw_line.contains("Done") || raw_line.contains("Completed") {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Done,
                timestamp: now,
            });
        }
        None
    }

    async fn detect_auth(&self) -> Result<(), String> {
        // Check OPENAI_API_KEY env var
        if std::env::var("OPENAI_API_KEY").is_ok() {
            return Ok(());
        }
        // Check if binary exists
        let mut cmd = std::process::Command::new("codex");
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
                Ok(output) if output.status.success() => {
                    Err("Codex CLI is installed but OPENAI_API_KEY is not set. Set it in your environment.".to_string())
                }
                _ => Err("Codex CLI may not be properly installed. Run: npm install -g @openai/codex".to_string()),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err("Codex CLI not found. Install it first: npm install -g @openai/codex".to_string())
            }
            Err(e) => Err(format!("Failed to check Codex CLI: {}", e)),
        }
    }
}
