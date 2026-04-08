// ===== Agent 命令层测试 =====
// 验证 Agent 命令相关类型的序列化/反序列化正确性
// 验证错误变体的正确构造和序列化
// 验证命令返回类型的 JSON 结构与前端期望一致
//
// 注意：由于 BE-2/BE-3 模块尚未实现，无法直接导入 crate 类型
// 因此使用内联类型定义（与 core/types.rs 和 core/error.rs 保持一致）
// 待所有 BE 模块完成后，应替换为 `use conflux_lib::core::*;`

#[cfg(test)]
mod agent_command_tests {
    use serde::{Deserialize, Serialize};
    use serde_json;

    // ===== 内联类型定义（与 core/ 模块保持一致） =====

    #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
    struct InstanceId(String);

    #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
    struct AdapterId(String);

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

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct AgentInstanceInfo {
        instance_id: InstanceId,
        adapter_id: AdapterId,
        adapter_name: String,
        status: AgentStatus,
        working_dir: String,
        is_primary_framework: bool,
        created_at: i64,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct AgentStateDetail {
        instance_id: InstanceId,
        adapter_id: AdapterId,
        adapter_name: String,
        status: AgentStatus,
        working_dir: String,
        is_primary_framework: bool,
        created_at: i64,
        last_activity_at: i64,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct SubAgentInfo {
        id: String,
        name: String,
        status: AgentStatus,
        parent_id: Option<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct AgentTree {
        root: SubAgentInfo,
        children: Vec<AgentTree>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "error_type", content = "details")]
    enum ConfluxError {
        InstanceNotFound { instance_id: String },
        AdapterNotFound { adapter_id: String },
        PtyError { message: String },
        ProcessExited { instance_id: String },
        WindowError { message: String },
    }

    // ===== AgentInstanceInfo 序列化测试 =====

    #[test]
    fn test_agent_instance_info_serialization() {
        let info = AgentInstanceInfo {
            instance_id: InstanceId("inst-001".to_string()),
            adapter_id: AdapterId("claude-code".to_string()),
            adapter_name: "Claude Code".to_string(),
            status: AgentStatus::Idle,
            working_dir: "/home/user/project".to_string(),
            is_primary_framework: false,
            created_at: 1700000000000,
        };

        let json = serde_json::to_string(&info).expect("序列化 AgentInstanceInfo 失败");
        let parsed: serde_json::Value =
            serde_json::from_str(&json).expect("JSON 解析失败");

        // 验证所有字段存在且类型正确
        assert_eq!(parsed["instance_id"], "inst-001");
        assert_eq!(parsed["adapter_id"], "claude-code");
        assert_eq!(parsed["adapter_name"], "Claude Code");
        assert_eq!(parsed["status"], "idle");
        assert_eq!(parsed["working_dir"], "/home/user/project");
        assert_eq!(parsed["is_primary_framework"], false);
        assert_eq!(parsed["created_at"], 1700000000000_i64);
    }

    #[test]
    fn test_agent_instance_info_deserialization() {
        let json = r#"{
            "instance_id": "inst-002",
            "adapter_id": "codex-cli",
            "adapter_name": "Codex CLI",
            "status": "thinking",
            "working_dir": "D:\\projects\\test",
            "is_primary_framework": true,
            "created_at": 1700000001000
        }"#;

        let info: AgentInstanceInfo =
            serde_json::from_str(json).expect("反序列化 AgentInstanceInfo 失败");

        assert_eq!(info.instance_id.0, "inst-002");
        assert_eq!(info.adapter_id.0, "codex-cli");
        assert_eq!(info.adapter_name, "Codex CLI");
        assert_eq!(info.status, AgentStatus::Thinking);
        assert!(info.is_primary_framework);
    }

    #[test]
    fn test_agent_instance_info_roundtrip() {
        let original = AgentInstanceInfo {
            instance_id: InstanceId("roundtrip-test".to_string()),
            adapter_id: AdapterId("aider".to_string()),
            adapter_name: "Aider".to_string(),
            status: AgentStatus::Coding,
            working_dir: "/tmp/workspace".to_string(),
            is_primary_framework: false,
            created_at: 1700000002000,
        };

        let json = serde_json::to_string(&original).expect("序列化失败");
        let restored: AgentInstanceInfo = serde_json::from_str(&json).expect("反序列化失败");

        assert_eq!(original.instance_id.0, restored.instance_id.0);
        assert_eq!(original.adapter_id.0, restored.adapter_id.0);
        assert_eq!(original.status, restored.status);
        assert_eq!(original.created_at, restored.created_at);
    }

    // ===== AgentStateDetail 序列化测试 =====

    #[test]
    fn test_agent_state_detail_serialization() {
        let detail = AgentStateDetail {
            instance_id: InstanceId("state-001".to_string()),
            adapter_id: AdapterId("claude-code".to_string()),
            adapter_name: "Claude Code".to_string(),
            status: AgentStatus::WaitingPermission,
            working_dir: "/workspace".to_string(),
            is_primary_framework: true,
            created_at: 1700000000000,
            last_activity_at: 1700000005000,
        };

        let json = serde_json::to_string(&detail).expect("序列化 AgentStateDetail 失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("JSON 解析失败");

        assert_eq!(parsed["status"], "waiting_permission");
        assert_eq!(parsed["is_primary_framework"], true);
        assert_eq!(parsed["last_activity_at"], 1700000005000_i64);
    }

    #[test]
    fn test_agent_state_detail_all_statuses() {
        let statuses = vec![
            (AgentStatus::Idle, "idle"),
            (AgentStatus::Thinking, "thinking"),
            (AgentStatus::Coding, "coding"),
            (AgentStatus::WaitingPermission, "waiting_permission"),
            (AgentStatus::Done, "done"),
            (AgentStatus::Error, "error"),
        ];

        for (status, expected_str) in statuses {
            let detail = AgentStateDetail {
                instance_id: InstanceId("test".to_string()),
                adapter_id: AdapterId("test".to_string()),
                adapter_name: "Test".to_string(),
                status,
                working_dir: "/test".to_string(),
                is_primary_framework: false,
                created_at: 0,
                last_activity_at: 0,
            };

            let json = serde_json::to_string(&detail).expect("序列化失败");
            let parsed: serde_json::Value = serde_json::from_str(&json).expect("解析失败");
            assert_eq!(
                parsed["status"], expected_str,
                "状态 {:?} 应序列化为 {}",
                parsed["status"], expected_str
            );
        }
    }

    // ===== AgentTree 序列化测试 =====

    #[test]
    fn test_agent_tree_leaf_node() {
        let tree = AgentTree {
            root: SubAgentInfo {
                id: "root-agent".to_string(),
                name: "Main Agent".to_string(),
                status: AgentStatus::Thinking,
                parent_id: None,
            },
            children: vec![],
        };

        let json = serde_json::to_string(&tree).expect("序列化 AgentTree 失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("JSON 解析失败");

        assert_eq!(parsed["root"]["id"], "root-agent");
        assert_eq!(parsed["root"]["name"], "Main Agent");
        assert_eq!(parsed["root"]["status"], "thinking");
        assert!(parsed["root"]["parent_id"].is_null());
        assert!(parsed["children"].as_array().expect("children 应为数组").is_empty());
    }

    #[test]
    fn test_agent_tree_nested_structure() {
        let tree = AgentTree {
            root: SubAgentInfo {
                id: "root".to_string(),
                name: "Orchestrator".to_string(),
                status: AgentStatus::Coding,
                parent_id: None,
            },
            children: vec![
                AgentTree {
                    root: SubAgentInfo {
                        id: "child-1".to_string(),
                        name: "File Worker".to_string(),
                        status: AgentStatus::Idle,
                        parent_id: Some("root".to_string()),
                    },
                    children: vec![],
                },
                AgentTree {
                    root: SubAgentInfo {
                        id: "child-2".to_string(),
                        name: "Test Runner".to_string(),
                        status: AgentStatus::Done,
                        parent_id: Some("root".to_string()),
                    },
                    children: vec![AgentTree {
                        root: SubAgentInfo {
                            id: "grandchild-1".to_string(),
                            name: "Unit Test Worker".to_string(),
                            status: AgentStatus::Done,
                            parent_id: Some("child-2".to_string()),
                        },
                        children: vec![],
                    }],
                },
            ],
        };

        let json = serde_json::to_string(&tree).expect("序列化嵌套 AgentTree 失败");
        let restored: AgentTree = serde_json::from_str(&json).expect("反序列化嵌套 AgentTree 失败");

        // 验证树结构完整性
        assert_eq!(restored.root.id, "root");
        assert_eq!(restored.children.len(), 2);
        assert_eq!(restored.children[0].root.id, "child-1");
        assert_eq!(restored.children[1].root.id, "child-2");
        assert_eq!(restored.children[1].children.len(), 1);
        assert_eq!(restored.children[1].children[0].root.id, "grandchild-1");
        assert_eq!(
            restored.children[1].children[0].root.parent_id,
            Some("child-2".to_string())
        );
    }

    #[test]
    fn test_agent_tree_roundtrip() {
        let tree = AgentTree {
            root: SubAgentInfo {
                id: "agent-rt".to_string(),
                name: "Roundtrip Agent".to_string(),
                status: AgentStatus::Thinking,
                parent_id: None,
            },
            children: vec![AgentTree {
                root: SubAgentInfo {
                    id: "sub-rt".to_string(),
                    name: "Sub Agent".to_string(),
                    status: AgentStatus::Idle,
                    parent_id: Some("agent-rt".to_string()),
                },
                children: vec![],
            }],
        };

        let json = serde_json::to_string(&tree).expect("序列化失败");
        let restored: AgentTree = serde_json::from_str(&json).expect("反序列化失败");

        assert_eq!(tree.root.id, restored.root.id);
        assert_eq!(tree.children.len(), restored.children.len());
        assert_eq!(tree.children[0].root.id, restored.children[0].root.id);
    }

    // ===== 错误类型构造测试 =====

    #[test]
    fn test_instance_not_found_error() {
        let err = ConfluxError::InstanceNotFound {
            instance_id: "missing-instance-123".to_string(),
        };

        let json = serde_json::to_string(&err).expect("序列化错误失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("JSON 解析失败");

        assert_eq!(parsed["error_type"], "InstanceNotFound");
        assert_eq!(parsed["details"]["instance_id"], "missing-instance-123");
    }

    #[test]
    fn test_adapter_not_found_error() {
        let err = ConfluxError::AdapterNotFound {
            adapter_id: "nonexistent-adapter".to_string(),
        };

        let json = serde_json::to_string(&err).expect("序列化错误失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("JSON 解析失败");

        assert_eq!(parsed["error_type"], "AdapterNotFound");
        assert_eq!(parsed["details"]["adapter_id"], "nonexistent-adapter");
    }

    #[test]
    fn test_pty_error() {
        let err = ConfluxError::PtyError {
            message: "进程已意外退出".to_string(),
        };

        let json = serde_json::to_string(&err).expect("序列化错误失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("JSON 解析失败");

        assert_eq!(parsed["error_type"], "PtyError");
        assert_eq!(parsed["details"]["message"], "进程已意外退出");
    }

    #[test]
    fn test_process_exited_error() {
        let err = ConfluxError::ProcessExited {
            instance_id: "exited-001".to_string(),
        };

        let json = serde_json::to_string(&err).expect("序列化错误失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("JSON 解析失败");

        assert_eq!(parsed["error_type"], "ProcessExited");
        assert_eq!(parsed["details"]["instance_id"], "exited-001");
    }

    // ===== 命令参数序列化测试 =====

    /// 验证 create_agent_instance 命令参数的 JSON 结构
    /// 前端通过 invoke() 传递的参数格式
    #[test]
    fn test_create_agent_command_params() {
        #[derive(Serialize, Deserialize)]
        struct CreateAgentParams {
            adapter_id: AdapterId,
            working_dir: Option<String>,
            args: Option<Vec<String>>,
        }

        // 最小参数（仅 adapter_id）
        let minimal = CreateAgentParams {
            adapter_id: AdapterId("claude-code".to_string()),
            working_dir: None,
            args: None,
        };

        let json = serde_json::to_string(&minimal).expect("序列化最小参数失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("解析失败");
        assert_eq!(parsed["adapter_id"], "claude-code");
        assert!(parsed["working_dir"].is_null());
        assert!(parsed["args"].is_null());

        // 完整参数
        let full = CreateAgentParams {
            adapter_id: AdapterId("aider".to_string()),
            working_dir: Some("/home/user/project".to_string()),
            args: Some(vec!["--model".to_string(), "gpt-4".to_string()]),
        };

        let json = serde_json::to_string(&full).expect("序列化完整参数失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("解析失败");
        assert_eq!(parsed["adapter_id"], "aider");
        assert_eq!(parsed["working_dir"], "/home/user/project");
        assert_eq!(parsed["args"][0], "--model");
        assert_eq!(parsed["args"][1], "gpt-4");
    }

    /// 验证 destroy/get_agent_state/get_agent_tree 命令参数格式
    #[test]
    fn test_instance_id_command_params() {
        #[derive(Serialize, Deserialize)]
        struct InstanceIdParam {
            instance_id: InstanceId,
        }

        let param = InstanceIdParam {
            instance_id: InstanceId("inst-target-001".to_string()),
        };

        let json = serde_json::to_string(&param).expect("序列化失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("解析失败");
        assert_eq!(parsed["instance_id"], "inst-target-001");

        // 从 JSON 字符串反序列化
        let restored: InstanceIdParam = serde_json::from_str(&json).expect("反序列化失败");
        assert_eq!(restored.instance_id.0, "inst-target-001");
    }

    // ===== 列表返回类型测试 =====

    #[test]
    fn test_empty_instance_list() {
        let list: Vec<AgentInstanceInfo> = vec![];
        let json = serde_json::to_string(&list).expect("序列化空列表失败");
        assert_eq!(json, "[]");
    }

    #[test]
    fn test_multiple_instance_list() {
        let list = vec![
            AgentInstanceInfo {
                instance_id: InstanceId("inst-a".to_string()),
                adapter_id: AdapterId("claude-code".to_string()),
                adapter_name: "Claude Code".to_string(),
                status: AgentStatus::Thinking,
                working_dir: "/project-a".to_string(),
                is_primary_framework: true,
                created_at: 1700000000000,
            },
            AgentInstanceInfo {
                instance_id: InstanceId("inst-b".to_string()),
                adapter_id: AdapterId("aider".to_string()),
                adapter_name: "Aider".to_string(),
                status: AgentStatus::Idle,
                working_dir: "/project-b".to_string(),
                is_primary_framework: false,
                created_at: 1700000001000,
            },
        ];

        let json = serde_json::to_string(&list).expect("序列化实例列表失败");
        let restored: Vec<AgentInstanceInfo> =
            serde_json::from_str(&json).expect("反序列化实例列表失败");

        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].instance_id.0, "inst-a");
        assert_eq!(restored[0].status, AgentStatus::Thinking);
        assert!(restored[0].is_primary_framework);
        assert_eq!(restored[1].instance_id.0, "inst-b");
        assert_eq!(restored[1].status, AgentStatus::Idle);
        assert!(!restored[1].is_primary_framework);
    }

    // ===== InstanceId/AdapterId Newtype 测试 =====

    #[test]
    fn test_instance_id_newtype_serialization() {
        let id = InstanceId("test-id-123".to_string());
        let json = serde_json::to_string(&id).expect("序列化 InstanceId 失败");
        // Newtype 应直接序列化为字符串
        assert_eq!(json, "\"test-id-123\"");
    }

    #[test]
    fn test_adapter_id_newtype_serialization() {
        let id = AdapterId("claude-code".to_string());
        let json = serde_json::to_string(&id).expect("序列化 AdapterId 失败");
        assert_eq!(json, "\"claude-code\"");
    }

    #[test]
    fn test_instance_id_deserialization_from_string() {
        let id: InstanceId =
            serde_json::from_str("\"my-instance\"").expect("反序列化 InstanceId 失败");
        assert_eq!(id.0, "my-instance");
    }
}
