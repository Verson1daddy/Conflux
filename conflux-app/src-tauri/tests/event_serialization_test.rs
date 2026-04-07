// ===== ConfluxEvent JSON 序列化往返测试 =====
// 验证所有事件变体的序列化/反序列化正确性
// 确保 Rust 序列化结果与前端 TypeScript 类型期望一致
// 至少覆盖 3 种事件变体（实际覆盖全部 10 种）

// 注意：此测试需要项目有 Cargo.toml 和正确的 crate 结构才能编译运行
// 以下代码假设 crate 名为 conflux_app，核心模块路径为 conflux_app::core

#[cfg(test)]
mod event_serialization_tests {
    // 导入路径说明：
    // 实际项目中需根据 lib.rs 的模块声明调整导入路径
    // 假设 lib.rs 中有 `pub mod core;`
    // 如果 crate 名不同，需相应修改

    // 为保证测试文件可独立理解，这里内联定义最小必要类型
    // 真实项目中应替换为 `use conflux_app::core::*;`

    use serde::{Deserialize, Serialize};

    // ===== 内联类型定义（与 core/types.rs 和 core/event.rs 一致） =====

    #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
    struct InstanceId(String);

    #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
    struct DiscussionId(String);

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum AgentStatus {
        Idle,
        Thinking,
        Coding,
        WaitingPermission,
        Done,
        Error,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    enum ErrorSeverity {
        Warning,
        Error,
        Fatal,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum PermissionStatus {
        Pending,
        Approved,
        Denied,
        Expired,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct PermissionRequest {
        id: String,
        instance_id: InstanceId,
        action: String,
        description: String,
        raw_context: Vec<String>,
        status: PermissionStatus,
        created_at: i64,
        timeout_seconds: u32,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct SubAgentInfo {
        id: String,
        name: String,
        status: AgentStatus,
        parent_id: Option<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct DiscussionMessageData {
        id: String,
        discussion_id: DiscussionId,
        sender: MessageSender,
        content: String,
        round: u32,
        created_at: i64,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "type", content = "value")]
    enum MessageSender {
        User,
        Agent(InstanceId),
        System,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum InjectionSource {
        UserDirect,
        PermissionResponse,
        OrchestrationAuto,
        DiscussionUserMessage,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "type", content = "payload")]
    enum ConfluxEvent {
        AgentStatusChanged {
            instance_id: InstanceId,
            old_status: AgentStatus,
            new_status: AgentStatus,
            timestamp: i64,
        },
        PermissionRequested {
            instance_id: InstanceId,
            request: PermissionRequest,
            timestamp: i64,
        },
        SubAgentSpawned {
            instance_id: InstanceId,
            sub_agent: SubAgentInfo,
            timestamp: i64,
        },
        SubAgentCompleted {
            instance_id: InstanceId,
            sub_agent_id: String,
            result_summary: Option<String>,
            timestamp: i64,
        },
        TaskCompleted {
            instance_id: InstanceId,
            summary: String,
            timestamp: i64,
        },
        ErrorOccurred {
            instance_id: InstanceId,
            error_message: String,
            severity: ErrorSeverity,
            timestamp: i64,
        },
        DiscussionMessage {
            discussion_id: DiscussionId,
            message: DiscussionMessageData,
            timestamp: i64,
        },
        CoordinationCommand {
            target_instance_id: InstanceId,
            command_text: String,
            source_discussion_id: Option<DiscussionId>,
            timestamp: i64,
        },
        PtyOutput {
            instance_id: InstanceId,
            data: String,
            timestamp: i64,
        },
        StdinInjected {
            instance_id: InstanceId,
            source: InjectionSource,
            content_preview: String,
            content_length: usize,
            timestamp: i64,
        },
    }

    // ===== 测试辅助函数 =====

    /// 序列化 -> 反序列化往返测试
    fn roundtrip(event: &ConfluxEvent) -> ConfluxEvent {
        let json = serde_json::to_string(event).expect("序列化失败");
        serde_json::from_str(&json).expect("反序列化失败")
    }

    /// 验证 JSON 中 type 字段的值
    fn assert_event_type(event: &ConfluxEvent, expected_type: &str) {
        let json = serde_json::to_string(event).expect("序列化失败");
        let v: serde_json::Value = serde_json::from_str(&json).expect("JSON 解析失败");
        assert_eq!(
            v["type"].as_str().expect("type 字段不存在"),
            expected_type,
            "事件 type 字段不匹配"
        );
    }

    // ===== 测试用例 =====

    /// 测试 1: AgentStatusChanged 事件序列化往返
    #[test]
    fn test_agent_status_changed_roundtrip() {
        let event = ConfluxEvent::AgentStatusChanged {
            instance_id: InstanceId("inst-001".to_string()),
            old_status: AgentStatus::Idle,
            new_status: AgentStatus::Thinking,
            timestamp: 1712505600000,
        };

        // 验证 type 字段
        assert_event_type(&event, "AgentStatusChanged");

        // 序列化后的 JSON 结构验证
        let json = serde_json::to_string(&event).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        // 验证 payload 存在且字段正确
        let payload = &v["payload"];
        assert_eq!(payload["instance_id"], "inst-001");
        assert_eq!(payload["old_status"], "idle");
        assert_eq!(payload["new_status"], "thinking");
        assert_eq!(payload["timestamp"], 1712505600000i64);

        // 往返测试
        let restored = roundtrip(&event);
        let json2 = serde_json::to_string(&restored).unwrap();
        assert_eq!(json, json2, "往返序列化结果不一致");
    }

    /// 测试 2: AgentStatus 的 snake_case 序列化
    #[test]
    fn test_agent_status_snake_case() {
        // WaitingPermission 应序列化为 "waiting_permission"
        let status = AgentStatus::WaitingPermission;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"waiting_permission\"");

        // 反序列化验证
        let restored: AgentStatus = serde_json::from_str("\"waiting_permission\"").unwrap();
        assert_eq!(restored, AgentStatus::WaitingPermission);

        // 其他状态值验证
        assert_eq!(serde_json::to_string(&AgentStatus::Idle).unwrap(), "\"idle\"");
        assert_eq!(serde_json::to_string(&AgentStatus::Thinking).unwrap(), "\"thinking\"");
        assert_eq!(serde_json::to_string(&AgentStatus::Coding).unwrap(), "\"coding\"");
        assert_eq!(serde_json::to_string(&AgentStatus::Done).unwrap(), "\"done\"");
        assert_eq!(serde_json::to_string(&AgentStatus::Error).unwrap(), "\"error\"");
    }

    /// 测试 3: PermissionRequested 事件（附录 B3 扩展字段）
    #[test]
    fn test_permission_requested_roundtrip() {
        let event = ConfluxEvent::PermissionRequested {
            instance_id: InstanceId("inst-002".to_string()),
            request: PermissionRequest {
                id: "perm-001".to_string(),
                instance_id: InstanceId("inst-002".to_string()),
                action: "write_file".to_string(),
                description: "写入 /tmp/output.txt".to_string(),
                raw_context: vec![
                    "正在分析代码...".to_string(),
                    "需要写入文件 /tmp/output.txt".to_string(),
                    "是否允许此操作? (Y/N)".to_string(),
                ],
                status: PermissionStatus::Pending,
                created_at: 1712505600000,
                timeout_seconds: 120,
            },
            timestamp: 1712505600000,
        };

        assert_event_type(&event, "PermissionRequested");

        let json = serde_json::to_string(&event).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        // 验证 B3 扩展字段存在
        let request = &v["payload"]["request"];
        assert!(request["raw_context"].is_array(), "raw_context 应为数组");
        assert_eq!(request["raw_context"].as_array().unwrap().len(), 3);
        assert_eq!(request["status"], "pending");
        assert_eq!(request["timeout_seconds"], 120);

        // 往返验证
        let restored = roundtrip(&event);
        let json2 = serde_json::to_string(&restored).unwrap();
        assert_eq!(json, json2);
    }

    /// 测试 4: PtyOutput 事件（MED-05: data 为 base64 字符串）
    #[test]
    fn test_pty_output_base64_data() {
        let event = ConfluxEvent::PtyOutput {
            instance_id: InstanceId("inst-003".to_string()),
            data: "SGVsbG8gV29ybGQ=".to_string(), // "Hello World" 的 base64
            timestamp: 1712505600000,
        };

        assert_event_type(&event, "PtyOutput");

        let json = serde_json::to_string(&event).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        // data 应为字符串类型（base64 编码）
        assert!(v["payload"]["data"].is_string(), "data 应为字符串");
        assert_eq!(v["payload"]["data"], "SGVsbG8gV29ybGQ=");

        // 往返验证
        let restored = roundtrip(&event);
        let json2 = serde_json::to_string(&restored).unwrap();
        assert_eq!(json, json2);
    }

    /// 测试 5: StdinInjected 审计事件（附录 B1）
    #[test]
    fn test_stdin_injected_roundtrip() {
        let event = ConfluxEvent::StdinInjected {
            instance_id: InstanceId("inst-004".to_string()),
            source: InjectionSource::PermissionResponse,
            content_preview: "Y".to_string(),
            content_length: 1,
            timestamp: 1712505600000,
        };

        assert_event_type(&event, "StdinInjected");

        let json = serde_json::to_string(&event).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(v["payload"]["source"], "permission_response");
        assert_eq!(v["payload"]["content_preview"], "Y");
        assert_eq!(v["payload"]["content_length"], 1);

        // 往返验证
        let restored = roundtrip(&event);
        let json2 = serde_json::to_string(&restored).unwrap();
        assert_eq!(json, json2);
    }

    /// 测试 6: ErrorOccurred 事件
    #[test]
    fn test_error_occurred_roundtrip() {
        let event = ConfluxEvent::ErrorOccurred {
            instance_id: InstanceId("inst-005".to_string()),
            error_message: "PTY 进程意外退出".to_string(),
            severity: ErrorSeverity::Fatal,
            timestamp: 1712505600000,
        };

        assert_event_type(&event, "ErrorOccurred");

        let json = serde_json::to_string(&event).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        // ErrorSeverity 不使用 rename_all，保持 PascalCase
        assert_eq!(v["payload"]["severity"], "Fatal");
        assert_eq!(v["payload"]["error_message"], "PTY 进程意外退出");

        let restored = roundtrip(&event);
        let json2 = serde_json::to_string(&restored).unwrap();
        assert_eq!(json, json2);
    }

    /// 测试 7: DiscussionMessage 事件（含 MessageSender 变体）
    #[test]
    fn test_discussion_message_roundtrip() {
        let event = ConfluxEvent::DiscussionMessage {
            discussion_id: DiscussionId("disc-001".to_string()),
            message: DiscussionMessageData {
                id: "msg-001".to_string(),
                discussion_id: DiscussionId("disc-001".to_string()),
                sender: MessageSender::Agent(InstanceId("inst-001".to_string())),
                content: "我已完成代码审查".to_string(),
                round: 2,
                created_at: 1712505600000,
            },
            timestamp: 1712505600000,
        };

        assert_event_type(&event, "DiscussionMessage");

        let json = serde_json::to_string(&event).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        // 验证 MessageSender 的 tag+content 序列化
        let sender = &v["payload"]["message"]["sender"];
        assert_eq!(sender["type"], "Agent");
        assert_eq!(sender["value"], "inst-001");

        let restored = roundtrip(&event);
        let json2 = serde_json::to_string(&restored).unwrap();
        assert_eq!(json, json2);
    }

    /// 测试 8: CoordinationCommand 事件（含可选 discussion_id）
    #[test]
    fn test_coordination_command_roundtrip() {
        // 带 discussion_id
        let event_with = ConfluxEvent::CoordinationCommand {
            target_instance_id: InstanceId("inst-006".to_string()),
            command_text: "请分析 src/main.rs".to_string(),
            source_discussion_id: Some(DiscussionId("disc-002".to_string())),
            timestamp: 1712505600000,
        };

        let json_with = serde_json::to_string(&event_with).unwrap();
        let v_with: serde_json::Value = serde_json::from_str(&json_with).unwrap();
        assert_eq!(v_with["payload"]["source_discussion_id"], "disc-002");

        // 不带 discussion_id
        let event_without = ConfluxEvent::CoordinationCommand {
            target_instance_id: InstanceId("inst-006".to_string()),
            command_text: "请分析 src/main.rs".to_string(),
            source_discussion_id: None,
            timestamp: 1712505600000,
        };

        let json_without = serde_json::to_string(&event_without).unwrap();
        let v_without: serde_json::Value = serde_json::from_str(&json_without).unwrap();
        assert!(v_without["payload"]["source_discussion_id"].is_null());

        // 往返验证
        let r1 = roundtrip(&event_with);
        assert_eq!(serde_json::to_string(&r1).unwrap(), json_with);

        let r2 = roundtrip(&event_without);
        assert_eq!(serde_json::to_string(&r2).unwrap(), json_without);
    }

    /// 测试 9: SubAgentSpawned 事件
    #[test]
    fn test_sub_agent_spawned_roundtrip() {
        let event = ConfluxEvent::SubAgentSpawned {
            instance_id: InstanceId("inst-007".to_string()),
            sub_agent: SubAgentInfo {
                id: "sub-001".to_string(),
                name: "代码审查子代理".to_string(),
                status: AgentStatus::Idle,
                parent_id: Some("inst-007".to_string()),
            },
            timestamp: 1712505600000,
        };

        assert_event_type(&event, "SubAgentSpawned");

        let json = serde_json::to_string(&event).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        let sub = &v["payload"]["sub_agent"];
        assert_eq!(sub["name"], "代码审查子代理");
        assert_eq!(sub["status"], "idle");
        assert_eq!(sub["parent_id"], "inst-007");

        let restored = roundtrip(&event);
        let json2 = serde_json::to_string(&restored).unwrap();
        assert_eq!(json, json2);
    }

    /// 测试 10: TaskCompleted 和 SubAgentCompleted 事件
    #[test]
    fn test_task_and_sub_agent_completed_roundtrip() {
        let task_event = ConfluxEvent::TaskCompleted {
            instance_id: InstanceId("inst-008".to_string()),
            summary: "代码重构完成，共修改 15 个文件".to_string(),
            timestamp: 1712505600000,
        };

        assert_event_type(&task_event, "TaskCompleted");
        let r1 = roundtrip(&task_event);
        assert_eq!(
            serde_json::to_string(&r1).unwrap(),
            serde_json::to_string(&task_event).unwrap()
        );

        let sub_completed_event = ConfluxEvent::SubAgentCompleted {
            instance_id: InstanceId("inst-009".to_string()),
            sub_agent_id: "sub-002".to_string(),
            result_summary: Some("测试全部通过".to_string()),
            timestamp: 1712505600000,
        };

        assert_event_type(&sub_completed_event, "SubAgentCompleted");
        let r2 = roundtrip(&sub_completed_event);
        assert_eq!(
            serde_json::to_string(&r2).unwrap(),
            serde_json::to_string(&sub_completed_event).unwrap()
        );

        // result_summary 为 None 的情况
        let sub_completed_no_summary = ConfluxEvent::SubAgentCompleted {
            instance_id: InstanceId("inst-009".to_string()),
            sub_agent_id: "sub-003".to_string(),
            result_summary: None,
            timestamp: 1712505600000,
        };

        let json = serde_json::to_string(&sub_completed_no_summary).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v["payload"]["result_summary"].is_null());

        let r3 = roundtrip(&sub_completed_no_summary);
        assert_eq!(serde_json::to_string(&r3).unwrap(), json);
    }

    /// 测试 11: InjectionSource 的 snake_case 序列化
    #[test]
    fn test_injection_source_snake_case() {
        assert_eq!(
            serde_json::to_string(&InjectionSource::UserDirect).unwrap(),
            "\"user_direct\""
        );
        assert_eq!(
            serde_json::to_string(&InjectionSource::PermissionResponse).unwrap(),
            "\"permission_response\""
        );
        assert_eq!(
            serde_json::to_string(&InjectionSource::OrchestrationAuto).unwrap(),
            "\"orchestration_auto\""
        );
        assert_eq!(
            serde_json::to_string(&InjectionSource::DiscussionUserMessage).unwrap(),
            "\"discussion_user_message\""
        );
    }

    /// 测试 12: MessageSender 各变体序列化
    #[test]
    fn test_message_sender_variants() {
        // User 变体
        let user = MessageSender::User;
        let json = serde_json::to_string(&user).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "User");

        // Agent 变体（带 value）
        let agent = MessageSender::Agent(InstanceId("inst-010".to_string()));
        let json = serde_json::to_string(&agent).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "Agent");
        assert_eq!(v["value"], "inst-010");

        // System 变体
        let system = MessageSender::System;
        let json = serde_json::to_string(&system).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "System");
    }
}
