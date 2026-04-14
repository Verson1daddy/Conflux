// ===== Conflux 上下文聚合器 =====
// 从多个 Agent 实例的状态信息中聚合出文本摘要
// 供编排层在构建调度指令时使用

use crate::core::AgentStateDetail;

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
            let primary_str = if inst.is_pinned {
                "是"
            } else {
                "否"
            };

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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AdapterId, AgentStatus, InstanceId};

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
            status: AgentStatus::Thinking,
            working_dir: "/home/user/project".to_string(),
            is_pinned: true,
            created_at: 1000,
            last_activity_at: 2000,
            mode: crate::core::AgentMode::Full,
            hidden: false,
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
                status: AgentStatus::Idle,
                working_dir: "/dir/a".to_string(),
                is_pinned: false,
                created_at: 1000,
                last_activity_at: 1500,
                mode: crate::core::AgentMode::Full,
                hidden: false,
            },
            AgentStateDetail {
                instance_id: InstanceId("b".to_string()),
                adapter_id: AdapterId("y".to_string()),
                adapter_name: "adapter-y".to_string(),
                status: AgentStatus::Coding,
                working_dir: "/dir/b".to_string(),
                is_pinned: true,
                created_at: 2000,
                last_activity_at: 2500,
                mode: crate::core::AgentMode::Full,
                hidden: false,
            },
        ];

        let result = ContextAggregator::aggregate(&instances);
        assert!(result.contains("共 2 个实例"));
        assert!(result.contains("[1]"));
        assert!(result.contains("[2]"));
        assert!(result.contains("idle"));
        assert!(result.contains("coding"));
    }
}
