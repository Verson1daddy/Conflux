// ===== Conflux 主框架协调器 =====
// 负责构建调度指令提示词并判断是否需要触发协调
// 当多个 Agent 状态发生变化时，协调器分析事件流并决定是否需要通知主框架

use crate::core::ConfluxEvent;

/// 主框架协调器
///
/// 核心职责:
/// 1. 根据上下文和适配器提供的 coordination_template 构建调度指令
/// 2. 分析事件流，判断是否应触发协调（避免每个小事件都触发）
pub struct Coordinator;

impl Coordinator {
    /// 使用模板和上下文构建调度指令提示词
    ///
    /// 将模板中的 `{context}` 占位符替换为实际的上下文摘要文本，
    /// 生成最终发送给主框架 Agent 的调度指令。
    ///
    /// # 参数
    /// - `context`: 由 ContextAggregator::aggregate() 生成的状态摘要文本
    /// - `template`: 适配器定义的 coordination_template（含 `{context}` 占位符）
    ///
    /// # 返回
    /// 替换占位符后的完整调度指令字符串
    ///
    /// # 示例
    /// ```text
    /// template: "请根据以下状态安排任务:\n{context}\n请输出调度计划。"
    /// context:  "=== Agent 状态摘要（共 2 个实例） ===\n..."
    /// result:   "请根据以下状态安排任务:\n=== Agent 状态摘要...===\n...\n请输出调度计划。"
    /// ```
    pub fn build_coordination_prompt(context: &str, template: &str) -> String {
        template.replace("{context}", context)
    }

    /// 判断是否需要触发协调
    ///
    /// 分析一批事件，当满足以下条件之一时返回 true：
    /// 1. 有 2 个或以上不同实例的状态变更事件（多 Agent 同时活跃）
    /// 2. 有任务完成事件（TaskCompleted）——可能需要重新分配工作
    /// 3. 有调度指令事件（CoordinationCommand）——表示已有显式协调请求
    /// 4. 有错误事件且严重级别 >= Error——可能需要紧急协调
    ///
    /// # 参数
    /// - `events`: 待分析的事件列表
    ///
    /// # 返回
    /// 是否应触发主框架协调
    pub fn should_coordinate(events: &[ConfluxEvent]) -> bool {
        if events.is_empty() {
            return false;
        }

        // 条件 2: 有任务完成事件
        let has_task_completed = events
            .iter()
            .any(|e| matches!(e, ConfluxEvent::TaskCompleted { .. }));
        if has_task_completed {
            return true;
        }

        // 条件 3: 有调度指令事件
        let has_coordination = events
            .iter()
            .any(|e| matches!(e, ConfluxEvent::CoordinationCommand { .. }));
        if has_coordination {
            return true;
        }

        // 条件 4: 有严重错误事件（Error 或 Fatal 级别）
        let has_severe_error = events.iter().any(|e| {
            matches!(
                e,
                ConfluxEvent::ErrorOccurred {
                    severity,
                    ..
                } if matches!(severity, crate::core::ErrorSeverity::Error | crate::core::ErrorSeverity::Fatal)
            )
        });
        if has_severe_error {
            return true;
        }

        // 条件 1: 多个不同实例的状态变更
        let mut status_change_instances = std::collections::HashSet::new();
        for event in events {
            if let ConfluxEvent::AgentStatusChanged { instance_id, .. } = event {
                status_change_instances.insert(instance_id.0.clone());
            }
        }
        if status_change_instances.len() >= 2 {
            return true;
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AgentStatus, ErrorSeverity, InstanceId};

    #[test]
    fn test_build_coordination_prompt() {
        let context = "Agent A: thinking\nAgent B: idle";
        let template = "当前状态:\n{context}\n请安排任务。";
        let result = Coordinator::build_coordination_prompt(context, template);
        assert!(result.contains("Agent A: thinking"));
        assert!(result.contains("请安排任务。"));
    }

    #[test]
    fn test_build_coordination_prompt_no_placeholder() {
        let result = Coordinator::build_coordination_prompt("ctx", "no placeholder here");
        assert_eq!(result, "no placeholder here");
    }

    #[test]
    fn test_should_coordinate_empty() {
        assert!(!Coordinator::should_coordinate(&[]));
    }

    #[test]
    fn test_should_coordinate_task_completed() {
        let events = vec![ConfluxEvent::TaskCompleted {
            instance_id: InstanceId("a".to_string()),
            summary: "done".to_string(),
            timestamp: 1000,
        }];
        assert!(Coordinator::should_coordinate(&events));
    }

    #[test]
    fn test_should_coordinate_multiple_status_changes() {
        let events = vec![
            ConfluxEvent::AgentStatusChanged {
                instance_id: InstanceId("a".to_string()),
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Thinking,
                timestamp: 1000,
            },
            ConfluxEvent::AgentStatusChanged {
                instance_id: InstanceId("b".to_string()),
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Coding,
                timestamp: 1001,
            },
        ];
        assert!(Coordinator::should_coordinate(&events));
    }

    #[test]
    fn test_should_not_coordinate_single_status_change() {
        let events = vec![ConfluxEvent::AgentStatusChanged {
            instance_id: InstanceId("a".to_string()),
            old_status: AgentStatus::Idle,
            new_status: AgentStatus::Thinking,
            timestamp: 1000,
        }];
        assert!(!Coordinator::should_coordinate(&events));
    }

    #[test]
    fn test_should_coordinate_severe_error() {
        let events = vec![ConfluxEvent::ErrorOccurred {
            instance_id: InstanceId("a".to_string()),
            error_message: "fatal crash".to_string(),
            severity: ErrorSeverity::Fatal,
            timestamp: 1000,
        }];
        assert!(Coordinator::should_coordinate(&events));
    }

    #[test]
    fn test_should_not_coordinate_warning() {
        let events = vec![ConfluxEvent::ErrorOccurred {
            instance_id: InstanceId("a".to_string()),
            error_message: "minor warning".to_string(),
            severity: ErrorSeverity::Warning,
            timestamp: 1000,
        }];
        assert!(!Coordinator::should_coordinate(&events));
    }
}
