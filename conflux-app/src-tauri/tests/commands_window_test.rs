// ===== 窗口管理命令层测试 =====
// 验证 IslandMode 序列化/反序列化正确性
// 验证窗口相关错误类型的构造和序列化
// 验证命令参数和返回值的 JSON 结构与前端期望一致
//
// 注意：由于 BE-2/BE-3 模块尚未实现，无法直接导入 crate 类型
// 因此使用内联类型定义（与 core/types.rs 和 core/error.rs 保持一致）
// 待所有 BE 模块完成后，应替换为 `use conflux_lib::core::*;`

#[cfg(test)]
mod window_command_tests {
    use serde::{Deserialize, Serialize};
    use serde_json;

    // ===== 内联类型定义（与 core/ 模块保持一致） =====

    #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
    struct InstanceId(String);

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum IslandMode {
        TopIsland,
        Sidebar,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "error_type", content = "details")]
    enum ConfluxError {
        WindowError { message: String },
        InstanceNotFound { instance_id: String },
    }

    // ===== IslandMode 序列化测试 =====

    #[test]
    fn test_island_mode_top_island_serialization() {
        let mode = IslandMode::TopIsland;
        let json = serde_json::to_string(&mode).expect("序列化 TopIsland 失败");
        assert_eq!(json, "\"top_island\"");
    }

    #[test]
    fn test_island_mode_sidebar_serialization() {
        let mode = IslandMode::Sidebar;
        let json = serde_json::to_string(&mode).expect("序列化 Sidebar 失败");
        assert_eq!(json, "\"sidebar\"");
    }

    #[test]
    fn test_island_mode_deserialization() {
        let cases = vec![
            ("\"top_island\"", IslandMode::TopIsland),
            ("\"sidebar\"", IslandMode::Sidebar),
        ];

        for (json_str, expected) in cases {
            let mode: IslandMode =
                serde_json::from_str(json_str).expect(&format!("反序列化 {} 失败", json_str));
            assert_eq!(mode, expected, "反序列化 {} 不匹配", json_str);
        }
    }

    #[test]
    fn test_island_mode_roundtrip() {
        let modes = vec![IslandMode::TopIsland, IslandMode::Sidebar];

        for mode in modes {
            let json = serde_json::to_string(&mode).expect("序列化失败");
            let restored: IslandMode = serde_json::from_str(&json).expect("反序列化失败");
            assert_eq!(mode, restored, "往返测试失败: {:?}", mode);
        }
    }

    #[test]
    fn test_island_mode_invalid_value() {
        let result: Result<IslandMode, _> = serde_json::from_str("\"invalid_mode\"");
        assert!(result.is_err(), "无效的 IslandMode 值应该导致反序列化错误");
    }

    // ===== 窗口错误类型测试 =====

    #[test]
    fn test_window_error_serialization() {
        let err = ConfluxError::WindowError {
            message: "无法创建工作台窗口: 内存不足".to_string(),
        };

        let json = serde_json::to_string(&err).expect("序列化 WindowError 失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("JSON 解析失败");

        assert_eq!(parsed["error_type"], "WindowError");
        assert_eq!(parsed["details"]["message"], "无法创建工作台窗口: 内存不足");
    }

    #[test]
    fn test_window_error_roundtrip() {
        let original = ConfluxError::WindowError {
            message: "灵动岛窗口不存在".to_string(),
        };

        let json = serde_json::to_string(&original).expect("序列化失败");
        let restored: ConfluxError = serde_json::from_str(&json).expect("反序列化失败");

        match restored {
            ConfluxError::WindowError { message } => {
                assert_eq!(message, "灵动岛窗口不存在");
            }
            _ => panic!("反序列化后类型不匹配"),
        }
    }

    // ===== switch_island_mode 命令参数测试 =====

    #[test]
    fn test_switch_island_mode_params() {
        #[derive(Serialize, Deserialize)]
        struct SwitchIslandModeParams {
            mode: IslandMode,
        }

        let params = SwitchIslandModeParams {
            mode: IslandMode::Sidebar,
        };

        let json = serde_json::to_string(&params).expect("序列化参数失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("解析失败");
        assert_eq!(parsed["mode"], "sidebar");
    }

    // ===== focus_agent_card 命令参数测试 =====

    #[test]
    fn test_focus_agent_card_params() {
        #[derive(Serialize, Deserialize)]
        struct FocusAgentCardParams {
            instance_id: InstanceId,
        }

        let params = FocusAgentCardParams {
            instance_id: InstanceId("target-agent-001".to_string()),
        };

        let json = serde_json::to_string(&params).expect("序列化参数失败");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("解析失败");
        assert_eq!(parsed["instance_id"], "target-agent-001");
    }

    // ===== get_island_mode 返回值测试 =====

    #[test]
    fn test_get_island_mode_return_type() {
        // 模拟 get_island_mode 命令的返回值
        // Result<IslandMode, ConfluxError> 成功时序列化
        let result: Result<IslandMode, ConfluxError> = Ok(IslandMode::TopIsland);

        // 序列化成功值
        if let Ok(mode) = &result {
            let json = serde_json::to_string(mode).expect("序列化返回值失败");
            assert_eq!(json, "\"top_island\"");
        }

        // 序列化错误值
        let error_result: Result<IslandMode, ConfluxError> = Err(ConfluxError::WindowError {
            message: "状态读取失败".to_string(),
        });

        if let Err(err) = &error_result {
            let json = serde_json::to_string(err).expect("序列化错误值失败");
            let parsed: serde_json::Value = serde_json::from_str(&json).expect("解析失败");
            assert_eq!(parsed["error_type"], "WindowError");
        }
    }

    // ===== 窗口配置常量验证测试 =====

    // ===== 事件载荷序列化测试（focus-agent-card 事件） =====

    #[test]
    fn test_focus_agent_card_event_payload() {
        // focus-agent-card 事件发送的是 InstanceId
        let payload = InstanceId("focused-agent-xyz".to_string());
        let json = serde_json::to_string(&payload).expect("序列化事件载荷失败");
        assert_eq!(json, "\"focused-agent-xyz\"");
    }

    #[test]
    fn test_island_mode_changed_event_payload() {
        // island-mode-changed 事件发送的是 IslandMode
        let payload = IslandMode::Sidebar;
        let json = serde_json::to_string(&payload).expect("序列化事件载荷失败");
        assert_eq!(json, "\"sidebar\"");
    }

    // ===== 边界情况测试 =====

    #[test]
    fn test_instance_id_with_special_characters() {
        let id = InstanceId("inst-uuid-4a3b2c1d-e5f6-7890-abcd-ef1234567890".to_string());
        let json = serde_json::to_string(&id).expect("序列化 UUID 格式 InstanceId 失败");
        let restored: InstanceId = serde_json::from_str(&json).expect("反序列化失败");
        assert_eq!(id.0, restored.0);
    }

    #[test]
    fn test_window_error_with_unicode_message() {
        let err = ConfluxError::WindowError {
            message: "窗口管理错误: ウィンドウが見つかりません (window not found)".to_string(),
        };

        let json = serde_json::to_string(&err).expect("序列化含 Unicode 的错误失败");
        let restored: ConfluxError = serde_json::from_str(&json).expect("反序列化失败");

        match restored {
            ConfluxError::WindowError { message } => {
                assert!(message.contains("ウィンドウ"));
                assert!(message.contains("window not found"));
            }
            _ => panic!("类型不匹配"),
        }
    }
}
