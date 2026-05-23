// ===== Conflux 内置适配器：Claude Code =====
// Claude Code CLI 框架的适配器实现
// 负责：声明 Claude Code 的能力、启动实例、解析 PTY 输出中的结构化信息
//
// Claude Code 特征：
// - 支持多 agent 协调（can_coordinate = true）
// - 支持 sub-agent 树解析（can_parse_tree = true）
// - 支持权限请求检测（can_detect_permission = true）
// - 使用 spinner 字符表示思考状态（⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏）
// - 使用 Writing/Editing/Creating 表示编码状态
// - 使用 Allow/Deny 表示权限请求

use async_trait::async_trait;
use regex::Regex;

use crate::adapter::traits::{AgentAdapter, AgentInstance};
use crate::core::{
    AdapterCapabilities, AdapterConfig, AgentStatus, ConfluxError, ConfluxEvent, InstanceId,
    PermissionRequest, PermissionStatus, StatusPatterns, SubAgentInfo,
};

/// Claude Code 适配器
pub struct ClaudeCodeAdapter {
    /// 适配器配置
    config: AdapterConfig,
    /// 能力声明
    capabilities: AdapterCapabilities,
    /// 预编译的正则模式
    patterns: ClaudeCodePatterns,
}

/// Claude Code 预编译正则模式集合
struct ClaudeCodePatterns {
    thinking: Regex,
    coding: Regex,
    done: Regex,
    error: Regex,
    waiting_permission: Regex,
    permission_request: Regex,
    sub_agent_spawn: Regex,
    sub_agent_complete: Regex,
}

impl ClaudeCodeAdapter {
    /// 创建 Claude Code 适配器实例
    /// 使用内置的默认正则模式
    pub fn new() -> Self {
        let capabilities = AdapterCapabilities {
            can_coordinate: true,
            coordination_template: Some(
                "You are coordinating with other agents in a Conflux workspace. \
                 Respond to coordination messages by analyzing the context and \
                 providing your expert input."
                    .to_string(),
            ),
            can_parse_tree: true,
            can_detect_permission: true,
        };

        let status_patterns = StatusPatterns {
            thinking: Some(r"⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|Thinking".to_string()),
            coding: Some(r"Writing|Editing|Creating".to_string()),
            done: Some(r"✓|Done|Completed".to_string()),
            error: Some(r"Error|✗|Failed".to_string()),
            waiting_permission: Some(r"Allow|Deny|approve".to_string()),
        };

        let config = AdapterConfig {
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            // Current Claude Code CLI no longer recognizes `--no-banner`
            // (removed upstream). Launching the binary with that flag fails
            // with `error: unknown option '--no-banner'` and exits instantly.
            // Leave default_args empty so the banner + onboarding wizard
            // shows up unchanged in the Conflux card terminal, which matches
            // the "user runs the real CLI" contract.
            default_args: vec![],
            sandbox_args: vec![],
            full_args: vec![],
            status_patterns,
            permission_pattern: Some(r"Allow|Deny|Do you want to".to_string()),
            sub_agent_spawn_pattern: Some(r"Spawning agent|Agent\(".to_string()),
            sub_agent_complete_pattern: Some(r"Agent completed|agent finished".to_string()),
            capabilities: capabilities.clone(),
        };

        // 预编译所有正则模式
        // 这些模式在适配器创建时编译一次，后续 parse_output 使用预编译版本
        let patterns = ClaudeCodePatterns {
            thinking: Regex::new(r"⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|Thinking")
                .expect("内置 thinking 正则编译失败"),
            coding: Regex::new(r"Writing|Editing|Creating").expect("内置 coding 正则编译失败"),
            done: Regex::new(r"✓|Done|Completed").expect("内置 done 正则编译失败"),
            error: Regex::new(r"Error|✗|Failed").expect("内置 error 正则编译失败"),
            waiting_permission: Regex::new(r"Allow|Deny|approve")
                .expect("内置 waiting_permission 正则编译失败"),
            permission_request: Regex::new(r"Allow|Deny|Do you want to")
                .expect("内置 permission_request 正则编译失败"),
            sub_agent_spawn: Regex::new(r"Spawning agent|Agent\(")
                .expect("内置 sub_agent_spawn 正则编译失败"),
            sub_agent_complete: Regex::new(r"Agent completed|agent finished")
                .expect("内置 sub_agent_complete 正则编译失败"),
        };

        Self {
            config,
            capabilities,
            patterns,
        }
    }

    /// 获取适配器配置（用于注册到 AdapterRegistry）
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
impl AgentAdapter for ClaudeCodeAdapter {
    fn name(&self) -> &str {
        "claude-code"
    }

    fn capabilities(&self) -> &AdapterCapabilities {
        &self.capabilities
    }

    async fn spawn(
        &self,
        _working_dir: &str,
        _args: &[String],
    ) -> Result<Box<dyn AgentInstance>, ConfluxError> {
        Err(ConfluxError::InvalidConfig {
            message: "ClaudeCodeAdapter::spawn is not a runnable path; use create_agent_instance/PtyManager::spawn".to_string(),
        })
    }

    async fn detect_auth(&self) -> Result<(), String> {
        // 尝试运行 `claude --version`。如果 binary 不存在或输出包含 auth 错误关键字，
        // 返回 Err 告知用户需要登录。
        let mut cmd = std::process::Command::new("claude");
        cmd.arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        match cmd.spawn() {
            Ok(child) => {
                match child.wait_with_output() {
                    Ok(output) => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        let combined = format!("{}{}", stdout, stderr);
                        if combined.contains("not logged in")
                            || combined.contains("auth")
                            || !output.status.success()
                        {
                            Err("Claude Code CLI is installed but may need login. Run: claude login".to_string())
                        } else {
                            Ok(())
                        }
                    }
                    Err(e) => Err(format!("Failed to check Claude Code CLI: {}", e)),
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Err("Claude Code CLI not found. Install it first: npm install -g @anthropic-ai/claude-code".to_string())
                } else {
                    Err(format!("Failed to run claude: {}", e))
                }
            }
        }
    }

    fn parse_output(&self, raw_line: &str) -> Option<ConfluxEvent> {
        // 使用占位 instance_id——实际运行时由 PTY 输出处理层设置
        let placeholder_id = InstanceId("unknown".to_string());
        let now = Self::now_ms();

        // 检测优先级（从高到低）：
        // 1. 权限请求——需要用户立即响应
        // 2. 错误——可能需要关注
        // 3. 等待权限状态
        // 4. 编码——活跃工作状态
        // 5. 思考——推理中
        // 6. 完成——任务结束
        // 7. Sub-agent 事件——树结构变化

        // 1. 权限请求检测（最高优先级）
        if self.patterns.permission_request.is_match(raw_line) {
            return Some(ConfluxEvent::PermissionRequested {
                instance_id: placeholder_id,
                request: PermissionRequest {
                    id: uuid::Uuid::new_v4().to_string(),
                    instance_id: InstanceId("unknown".to_string()),
                    action: "unknown".to_string(),
                    description: raw_line.to_string(),
                    raw_context: vec![raw_line.to_string()],
                    status: PermissionStatus::Pending,
                    created_at: now,
                    timeout_seconds: 120,
                },
                timestamp: now,
            });
        }

        // 2. 错误状态检测
        if self.patterns.error.is_match(raw_line) {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Error,
                timestamp: now,
            });
        }

        // 3. 等待权限状态检测
        if self.patterns.waiting_permission.is_match(raw_line) {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::WaitingPermission,
                timestamp: now,
            });
        }

        // 4. Sub-agent 生成检测（在状态检测之前，因为 "Agent(" 不应被误判为状态变更）
        if self.patterns.sub_agent_spawn.is_match(raw_line) {
            return Some(ConfluxEvent::SubAgentSpawned {
                instance_id: placeholder_id,
                sub_agent: SubAgentInfo {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: raw_line.to_string(),
                    status: AgentStatus::Idle,
                    parent_id: None,
                },
                timestamp: now,
            });
        }

        // 4. Sub-agent 完成检测
        if self.patterns.sub_agent_complete.is_match(raw_line) {
            return Some(ConfluxEvent::SubAgentCompleted {
                instance_id: placeholder_id,
                sub_agent_id: "unknown".to_string(),
                result_summary: Some(raw_line.to_string()),
                timestamp: now,
            });
        }

        // 5. 编码状态检测
        if self.patterns.coding.is_match(raw_line) {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Coding,
                timestamp: now,
            });
        }

        // 6. 思考状态检测
        if self.patterns.thinking.is_match(raw_line) {
            return Some(ConfluxEvent::AgentStatusChanged {
                instance_id: placeholder_id,
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Thinking,
                timestamp: now,
            });
        }

        // 7. 完成状态检测
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
}
