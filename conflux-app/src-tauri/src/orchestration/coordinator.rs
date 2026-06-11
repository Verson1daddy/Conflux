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
    /// 协调指令的自动 stdin 注入默认关闭，避免在用户正在操作的 CLI 会话中
    /// 突然塞入系统调度文本。只有显式设置环境变量时才开启。
    pub fn auto_injection_enabled() -> bool {
        std::env::var("CONFLUX_ENABLE_COORDINATOR_AUTOINJECT")
            .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "True"))
            .unwrap_or(false)
    }

    /// 使用模板和上下文构建调度指令提示词
    ///
    /// 将模板中的 `{context}` 占位符替换为实际的上下文摘要文本，
    /// 生成最终发送给主框架 Agent 的调度指令。
    pub fn build_coordination_prompt(context: &str, template: &str) -> String {
        template.replace("{context}", context)
    }

    /// 判断是否需要触发协调
    ///
    /// 触发条件**仅**基于系统侧结构化信号（status / 完成数 / 错误率 / 静默），
    /// **绝不**由被审计对象自身的 PTY/输出内容控制。
    ///
    /// 触发条件：
    /// 1. 任意 3 个不同实例在 5 分钟内各自完成 >=2 个 TaskCompleted
    /// 2. 任一实例的 ErrorOccurred 数 >= 该实例 TaskCompleted 数的 20%
    /// 3. 连续 10 分钟没有任何 AgentStatusChanged
    ///
    /// CRIT-02 / MF-3 修复（契约 §13.4）：原第 4 条「任一实例输出中出现『需要协调』
    /// 关键词即触发」已**删除**。该条件以被审计 agent 自身的 PTY 输出明文子串作为
    /// 自动协调注入的开关，构成 confused-deputy / indirect prompt injection 后门——
    /// 任意被接管 agent 只需打印「需要协调」即可诱发跨 agent 自动注入。触发集合现在
    /// **只**接受系统侧不可被内容伪造的结构化信号；当无可信触发条件命中时默认返回
    /// false（宁可不触发，不可被内容触发）。
    pub fn should_coordinate(events: &[ConfluxEvent]) -> bool {
        if events.is_empty() {
            return false;
        }

        if Self::has_dense_task_completions(events) {
            return true;
        }

        if Self::has_error_ratio_breach(events) {
            return true;
        }

        if Self::has_ten_minute_status_silence(events) {
            return true;
        }

        // CRIT-02 / MF-3：不再有任何基于不可信内容（PTY 输出子串）的触发分支。
        false
    }

    fn has_dense_task_completions(events: &[ConfluxEvent]) -> bool {
        let latest_ts = events
            .iter()
            .map(Self::event_timestamp_secs)
            .max()
            .unwrap_or(0);
        let mut completions_by_instance = std::collections::HashMap::<String, usize>::new();

        for event in events {
            if let ConfluxEvent::TaskCompleted { instance_id, .. } = event {
                let ts = Self::event_timestamp_secs(event);
                if latest_ts.saturating_sub(ts) > 5 * 60 {
                    continue;
                }
                *completions_by_instance
                    .entry(instance_id.0.clone())
                    .or_insert(0) += 1;
            }
        }

        completions_by_instance
            .values()
            .filter(|count| **count >= 2)
            .count()
            >= 3
    }

    fn has_error_ratio_breach(events: &[ConfluxEvent]) -> bool {
        let mut completed = std::collections::HashMap::<String, usize>::new();
        let mut errors = std::collections::HashMap::<String, usize>::new();

        for event in events {
            match event {
                ConfluxEvent::TaskCompleted { instance_id, .. } => {
                    *completed.entry(instance_id.0.clone()).or_insert(0) += 1;
                }
                ConfluxEvent::ErrorOccurred { instance_id, .. } => {
                    *errors.entry(instance_id.0.clone()).or_insert(0) += 1;
                }
                _ => {}
            }
        }

        errors.into_iter().any(|(instance_id, error_count)| {
            let completed_count = completed.get(&instance_id).copied().unwrap_or(0);
            completed_count > 0 && error_count * 5 >= completed_count
        })
    }

    fn has_ten_minute_status_silence(events: &[ConfluxEvent]) -> bool {
        let latest_ts = events
            .iter()
            .map(Self::event_timestamp_secs)
            .max()
            .unwrap_or(0);

        let latest_status_change = events
            .iter()
            .filter_map(|event| match event {
                ConfluxEvent::AgentStatusChanged { timestamp, .. } => {
                    Some((*timestamp).max(0) as u64 / 1000)
                }
                _ => None,
            })
            .max();

        match latest_status_change {
            Some(ts) => latest_ts.saturating_sub(ts) >= 10 * 60,
            None => latest_ts >= 10 * 60,
        }
    }

    fn event_timestamp_secs(event: &ConfluxEvent) -> u64 {
        match event {
            ConfluxEvent::AgentStatusChanged { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
            ConfluxEvent::PermissionRequested { timestamp, .. } => {
                (*timestamp).max(0) as u64 / 1000
            }
            ConfluxEvent::SubAgentSpawned { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
            ConfluxEvent::SubAgentCompleted { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
            ConfluxEvent::TaskCompleted { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
            ConfluxEvent::ErrorOccurred { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
            ConfluxEvent::DiscussionMessage { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
            ConfluxEvent::CoordinationCommand { timestamp, .. } => {
                (*timestamp).max(0) as u64 / 1000
            }
            ConfluxEvent::PtyOutput { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
            ConfluxEvent::StdinInjected { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
            ConfluxEvent::ProcessExited { timestamp, .. } => (*timestamp).max(0) as u64 / 1000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AgentStatus, ErrorSeverity, InstanceId};
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    use std::sync::{Mutex, OnceLock};

    static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn test_env_lock() -> &'static Mutex<()> {
        TEST_ENV_LOCK.get_or_init(|| Mutex::new(()))
    }

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
    fn test_auto_injection_disabled_by_default() {
        let _guard = test_env_lock().lock().expect("lock test env");
        let old = std::env::var("CONFLUX_ENABLE_COORDINATOR_AUTOINJECT").ok();
        std::env::remove_var("CONFLUX_ENABLE_COORDINATOR_AUTOINJECT");

        assert!(!Coordinator::auto_injection_enabled());

        if let Some(value) = old {
            std::env::set_var("CONFLUX_ENABLE_COORDINATOR_AUTOINJECT", value);
        }
    }

    #[test]
    fn test_auto_injection_enabled_only_when_explicitly_requested() {
        let _guard = test_env_lock().lock().expect("lock test env");
        let old = std::env::var("CONFLUX_ENABLE_COORDINATOR_AUTOINJECT").ok();
        std::env::set_var("CONFLUX_ENABLE_COORDINATOR_AUTOINJECT", "true");

        assert!(Coordinator::auto_injection_enabled());

        if let Some(value) = old {
            std::env::set_var("CONFLUX_ENABLE_COORDINATOR_AUTOINJECT", value);
        } else {
            std::env::remove_var("CONFLUX_ENABLE_COORDINATOR_AUTOINJECT");
        }
    }

    #[test]
    fn test_should_coordinate_empty() {
        assert!(!Coordinator::should_coordinate(&[]));
    }

    #[test]
    fn test_should_coordinate_three_instances_complete_twice_in_five_minutes() {
        let events = vec![
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 1000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 2000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("b".to_string()),
                summary: "done".to_string(),
                timestamp: 3000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("b".to_string()),
                summary: "done".to_string(),
                timestamp: 4000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("c".to_string()),
                summary: "done".to_string(),
                timestamp: 5000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("c".to_string()),
                summary: "done".to_string(),
                timestamp: 6000,
            },
        ];
        assert!(Coordinator::should_coordinate(&events));
    }

    #[test]
    fn test_should_coordinate_three_instances_complete_twice_with_epoch_timestamps() {
        let base = 1_700_000_000_000i64;
        let events = vec![
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: base - 240_000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: base - 180_000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("b".to_string()),
                summary: "done".to_string(),
                timestamp: base - 120_000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("b".to_string()),
                summary: "done".to_string(),
                timestamp: base - 90_000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("c".to_string()),
                summary: "done".to_string(),
                timestamp: base - 60_000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("c".to_string()),
                summary: "done".to_string(),
                timestamp: base,
            },
        ];
        assert!(Coordinator::should_coordinate(&events));
    }

    #[test]
    fn test_should_not_coordinate_two_instances_only() {
        let events = vec![
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 1000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 2000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("b".to_string()),
                summary: "done".to_string(),
                timestamp: 3000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("b".to_string()),
                summary: "done".to_string(),
                timestamp: 4000,
            },
        ];
        assert!(!Coordinator::should_coordinate(&events));
    }

    #[test]
    fn test_should_coordinate_error_ratio_breach() {
        let events = vec![
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 1000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 2000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 3000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 4000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "done".to_string(),
                timestamp: 5000,
            },
            ConfluxEvent::ErrorOccurred {
                instance_id: InstanceId("a".to_string()),
                error_message: "boom".to_string(),
                severity: ErrorSeverity::Warning,
                timestamp: 6000,
            },
        ];
        assert!(Coordinator::should_coordinate(&events));
    }

    #[test]
    fn test_should_coordinate_ten_minute_status_silence() {
        let events = vec![
            ConfluxEvent::AgentStatusChanged {
                instance_id: InstanceId("a".to_string()),
                old_status: AgentStatus::Idle,
                new_status: AgentStatus::Thinking,
                timestamp: 1_000,
            },
            ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("a".to_string()),
                summary: "later event".to_string(),
                timestamp: 601_000,
            },
        ];
        assert!(Coordinator::should_coordinate(&events));
    }

    /// CRIT-02 / MF-3 后门中和回归测试（契约 §13.4）。
    ///
    /// 一条携带「需要协调」明文（base64 编码）的 PtyOutput 事件**不得**再触发自动协调。
    /// 这是 indirect prompt injection 后门的红线：被审计 agent 的输出内容绝不能成为
    /// 跨 agent 自动注入的开关。
    #[test]
    fn pty_output_keyword_no_longer_triggers_coordination() {
        let encoded = BASE64.encode("当前任务卡住了，需要协调".as_bytes());
        let events = vec![ConfluxEvent::PtyOutput {
            instance_id: InstanceId("a".to_string()),
            data: encoded,
            seq: None,
            timestamp: 1000,
        }];
        assert!(
            !Coordinator::should_coordinate(&events),
            "PTY 输出中的『需要协调』子串绝不能触发自动协调（CRIT-02 后门）"
        );
    }

    /// 同理：ErrorOccurred 的 error_message 含「需要协调」也不得触发（内容侧后门面）。
    #[test]
    fn error_message_keyword_no_longer_triggers_coordination() {
        let events = vec![ConfluxEvent::ErrorOccurred {
            instance_id: InstanceId("a".to_string()),
            error_message: "需要协调".to_string(),
            severity: ErrorSeverity::Warning,
            timestamp: 1000,
        }];
        assert!(
            !Coordinator::should_coordinate(&events),
            "ErrorOccurred 消息中的『需要协调』子串绝不能触发自动协调（CRIT-02 后门）"
        );
    }

    #[test]
    fn test_should_not_coordinate_without_any_trigger() {
        let events = vec![ConfluxEvent::AgentStatusChanged {
            instance_id: InstanceId("a".to_string()),
            old_status: AgentStatus::Idle,
            new_status: AgentStatus::Thinking,
            timestamp: 1000,
        }];
        assert!(!Coordinator::should_coordinate(&events));
    }
}
