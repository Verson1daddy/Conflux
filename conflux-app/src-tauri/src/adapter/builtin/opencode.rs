// ===== Conflux 内置适配器：OpenCode =====
// OpenCode CLI 框架的适配器实现

use async_trait::async_trait;

use crate::adapter::traits::{AgentAdapter, AgentInstance};
use crate::core::{
    AdapterCapabilities, AdapterConfig, AgentStatus, ConfluxError, ConfluxEvent, InstanceId,
    StatusPatterns,
};

pub struct OpenCodeAdapter {
    config: AdapterConfig,
    capabilities: AdapterCapabilities,
}

impl OpenCodeAdapter {
    pub fn new() -> Self {
        let capabilities = AdapterCapabilities {
            can_coordinate: false,
            coordination_template: None,
            can_parse_tree: false,
            can_detect_permission: false,
        };

        let status_patterns = StatusPatterns {
            thinking: Some(r"Thinking".to_string()),
            coding: Some(r"Writing|Editing".to_string()),
            done: Some(r"Done|Completed".to_string()),
            error: Some(r"Error|Failed".to_string()),
            waiting_permission: None,
        };

        let config = AdapterConfig {
            name: "OpenCode".to_string(),
            command: "opencode".to_string(),
            default_args: vec![],
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
impl AgentAdapter for OpenCodeAdapter {
    fn name(&self) -> &str {
        "opencode"
    }

    fn capabilities(&self) -> &AdapterCapabilities {
        &self.capabilities
    }

    async fn spawn(
        &self,
        _working_dir: &str,
        _args: &[String],
    ) -> Result<Box<dyn AgentInstance>, ConfluxError> {
        todo!("OpenCode spawn via PtyManager")
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
        // OpenCode uses ANTHROPIC_API_KEY or OPENAI_API_KEY
        let has_anthropic = std::env::var("ANTHROPIC_API_KEY").is_ok();
        let has_openai = std::env::var("OPENAI_API_KEY").is_ok();

        // Check binary existence
        let mut cmd = std::process::Command::new("opencode");
        cmd.arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let binary_ok = match cmd.spawn() {
            Ok(child) => child.wait_with_output().map(|o| o.status.success()).unwrap_or(false),
            Err(_) => false,
        };

        if !binary_ok {
            return Err(
                "OpenCode not found. Install it first: go install github.com/opencode-ai/opencode@latest"
                    .to_string(),
            );
        }

        if has_anthropic || has_openai {
            Ok(())
        } else {
            Err("OpenCode is installed but no API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.".to_string())
        }
    }
}
