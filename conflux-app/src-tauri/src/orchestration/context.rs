// ===== Conflux 上下文聚合器 =====
// 从多个 Agent 实例的状态信息中聚合出文本摘要
// 供编排层在构建调度指令时使用

use crate::core::{AgentStateDetail, ConfluxEvent};

/// 上下文聚合器——从多个 Agent 实例聚合产出状态摘要
///
/// 生成格式化的文本摘要，包含每个 Agent 实例的 ID、适配器名称、
/// 当前状态、工作目录等信息，供协调器构建调度指令时作为上下文输入。
pub struct ContextAggregator;

impl ContextAggregator {
    /// 聚合多个 Agent 实例的状态，生成文本摘要
    ///
    /// 输出格式示例:
    /// ```text
    /// === Agent 状态摘要（共 3 个实例） ===
    ///
    /// [1] inst-abc (claude-code) — 状态: thinking
    ///     工作目录: /home/user/project
    ///     钉选: 是
    ///     最后活动: 1714000000000
    ///
    /// [2] inst-def (codex-cli) — 状态: idle
    ///     工作目录: /home/user/other
    ///     钉选: 否
    ///     最后活动: 1714000001000
    /// ```
    ///
    /// # 参数
    /// - `instances`: Agent 实例状态详情的切片
    ///
    /// # 返回
    /// 格式化的文本摘要字符串
    pub fn aggregate(instances: &[AgentStateDetail]) -> String {
        if instances.is_empty() {
            return "=== Agent 状态摘要（无活跃实例） ===".to_string();
        }

        let mut lines = Vec::new();
        lines.push(format!(
            "=== Agent 状态摘要（共 {} 个实例） ===",
            instances.len()
        ));
        lines.push(String::new());

        for (i, inst) in instances.iter().enumerate() {
            let status_str = format!("{:?}", inst.status).to_lowercase();
            let primary_str = if inst.is_pinned { "是" } else { "否" };

            lines.push(format!(
                "[{}] {} ({}) — 状态: {}",
                i + 1,
                inst.instance_id.0,
                inst.adapter_name,
                status_str,
            ));
            lines.push(format!("    工作目录: {}", inst.working_dir));
            lines.push(format!("    钉选: {}", primary_str));
            lines.push(format!("    最后活动: {}", inst.last_activity_at));
            lines.push(String::new());
        }

        lines.join("\n")
    }

    pub fn aggregate_with_events(
        instances: &[AgentStateDetail],
        events: &[ConfluxEvent],
    ) -> String {
        let mut lines = vec![Self::aggregate(instances)];

        let sub_agent_lines = Self::format_sub_agents(instances);
        if !sub_agent_lines.is_empty() {
            lines.push(String::new());
            lines.push("=== Sub-agent context ===".to_string());
            lines.extend(sub_agent_lines);
        }

        let outcome_lines = Self::format_recent_outcomes(events);
        if !outcome_lines.is_empty() {
            lines.push(String::new());
            lines.push("=== Recent outcomes and errors ===".to_string());
            lines.extend(outcome_lines);
        }

        lines.join("\n")
    }

    fn format_sub_agents(instances: &[AgentStateDetail]) -> Vec<String> {
        let mut lines = Vec::new();
        for inst in instances {
            if inst.sub_agents.is_empty() {
                continue;
            }

            lines.push(format!(
                "{} sub_agents: {}",
                inst.instance_id.0,
                inst.sub_agents.len()
            ));
            for sub_agent in &inst.sub_agents {
                lines.push(format!(
                    "    - {} ({}) status: {:?}",
                    sub_agent.id, sub_agent.name, sub_agent.status
                ));
            }
        }
        lines
    }

    fn format_recent_outcomes(events: &[ConfluxEvent]) -> Vec<String> {
        let mut lines = Vec::new();
        for event in events.iter().rev() {
            match event {
                ConfluxEvent::TaskCompleted {
                    instance_id,
                    summary,
                    ..
                } => lines.push(format!(
                    "- task_completed {}: {}",
                    instance_id.0,
                    Self::truncate(summary, 160)
                )),
                ConfluxEvent::SubAgentCompleted {
                    instance_id,
                    sub_agent_id,
                    result_summary,
                    ..
                } => lines.push(format!(
                    "- sub_agent_completed {} / {}: {}",
                    instance_id.0,
                    sub_agent_id,
                    result_summary
                        .as_deref()
                        .map(|summary| Self::truncate(summary, 160))
                        .unwrap_or_else(|| "no summary".to_string())
                )),
                ConfluxEvent::ErrorOccurred {
                    instance_id,
                    error_message,
                    severity,
                    ..
                } => lines.push(format!(
                    "- error {} [{:?}]: {}",
                    instance_id.0,
                    severity,
                    Self::truncate(error_message, 160)
                )),
                _ => {}
            }

            if lines.len() >= 8 {
                break;
            }
        }
        lines.reverse();
        lines
    }

    fn truncate(text: &str, max_chars: usize) -> String {
        let mut chars = text.chars();
        let truncated: String = chars.by_ref().take(max_chars).collect();
        if chars.next().is_some() {
            format!("{truncated}...")
        } else {
            truncated
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{
        AdapterId, AgentStatus, ConfluxEvent, ErrorSeverity, InstanceId, SubAgentInfo,
    };

    #[test]
    fn test_aggregate_empty() {
        let result = ContextAggregator::aggregate(&[]);
        assert!(result.contains("无活跃实例"));
    }

    #[test]
    fn test_aggregate_single_instance() {
        let instances = vec![AgentStateDetail {
            instance_id: InstanceId("inst-001".to_string()),
            adapter_id: AdapterId("adapter-cc".to_string()),
            adapter_name: "claude-code".to_string(),
            display_name: None,
            status: AgentStatus::Thinking,
            working_dir: "/home/user/project".to_string(),
            is_pinned: true,
            created_at: 1000,
            last_activity_at: 2000,
            ended_at: None,
            mode: crate::core::AgentMode::Full,
            hidden: false,
            sub_agents: vec![],
        }];

        let result = ContextAggregator::aggregate(&instances);
        assert!(result.contains("共 1 个实例"));
        assert!(result.contains("inst-001"));
        assert!(result.contains("claude-code"));
        assert!(result.contains("thinking"));
        assert!(result.contains("钉选: 是"));
    }

    #[test]
    fn test_aggregate_multiple_instances() {
        let instances = vec![
            AgentStateDetail {
                instance_id: InstanceId("a".to_string()),
                adapter_id: AdapterId("x".to_string()),
                adapter_name: "adapter-x".to_string(),
                display_name: None,
                status: AgentStatus::Idle,
                working_dir: "/dir/a".to_string(),
                is_pinned: false,
                created_at: 1000,
                last_activity_at: 1500,
                ended_at: None,
                mode: crate::core::AgentMode::Full,
                hidden: false,
                sub_agents: vec![],
            },
            AgentStateDetail {
                instance_id: InstanceId("b".to_string()),
                adapter_id: AdapterId("y".to_string()),
                adapter_name: "adapter-y".to_string(),
                display_name: None,
                status: AgentStatus::Coding,
                working_dir: "/dir/b".to_string(),
                is_pinned: true,
                created_at: 2000,
                last_activity_at: 2500,
                ended_at: None,
                mode: crate::core::AgentMode::Full,
                hidden: false,
                sub_agents: vec![],
            },
        ];

        let result = ContextAggregator::aggregate(&instances);
        assert!(result.contains("共 2 个实例"));
        assert!(result.contains("[1]"));
        assert!(result.contains("[2]"));
        assert!(result.contains("idle"));
        assert!(result.contains("coding"));
    }

    #[test]
    fn test_aggregate_with_events_includes_sub_agents_and_recent_outcomes() {
        let instances = vec![AgentStateDetail {
            instance_id: InstanceId("inst-001".to_string()),
            adapter_id: AdapterId("adapter-cc".to_string()),
            adapter_name: "claude-code".to_string(),
            display_name: Some("Architect".to_string()),
            status: AgentStatus::Thinking,
            working_dir: "/home/user/project".to_string(),
            is_pinned: true,
            created_at: 1000,
            last_activity_at: 2000,
            ended_at: None,
            mode: crate::core::AgentMode::Full,
            hidden: false,
            sub_agents: vec![SubAgentInfo {
                id: "worker-1".to_string(),
                name: "Worker 1".to_string(),
                status: AgentStatus::Coding,
                parent_id: Some("inst-001".to_string()),
            }],
        }];
        let events = vec![
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("inst-001".to_string()),
                summary: "Wrote the V1 lifecycle spec".to_string(),
                timestamp: 3000,
            },
            ConfluxEvent::ErrorOccurred {
                instance_id: InstanceId("inst-001".to_string()),
                error_message: "adapter spawn failed".to_string(),
                severity: ErrorSeverity::Error,
                timestamp: 3100,
            },
            ConfluxEvent::PtyOutput {
                instance_id: InstanceId("inst-001".to_string()),
                data: "SGVsbG8=".to_string(),
                seq: None,
                timestamp: 3200,
            },
        ];

        let result = ContextAggregator::aggregate_with_events(&instances, &events);

        assert!(result.contains("sub_agents: 1"));
        assert!(result.contains("worker-1"));
        assert!(result.contains("Wrote the V1 lifecycle spec"));
        assert!(result.contains("adapter spawn failed"));
        assert!(!result.contains("SGVsbG8="));
    }
}
