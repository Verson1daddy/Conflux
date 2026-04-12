// ===== Claude Code 适配器单元测试 =====
// 测试 ClaudeCodeAdapter 的 parse_output 方法
// 验证各种 PTY 输出行被正确解析为 ConfluxEvent

use conflux_lib::adapter::builtin::claude_code::ClaudeCodeAdapter;
use conflux_lib::adapter::traits::AgentAdapter;
use conflux_lib::core::{AgentStatus, ConfluxEvent};

/// 创建 Claude Code 适配器实例
fn make_adapter() -> ClaudeCodeAdapter {
    ClaudeCodeAdapter::new()
}

/// 从 AgentStatusChanged 事件中提取 new_status
fn extract_new_status(event: &ConfluxEvent) -> Option<&AgentStatus> {
    match event {
        ConfluxEvent::AgentStatusChanged { new_status, .. } => Some(new_status),
        _ => None,
    }
}

// ===== 基本属性测试 =====

#[test]
fn test_adapter_name() {
    let adapter = make_adapter();
    assert_eq!(adapter.name(), "claude-code");
}

#[test]
fn test_adapter_capabilities() {
    let adapter = make_adapter();
    let caps = adapter.capabilities();
    assert!(caps.can_coordinate);
    assert!(caps.can_parse_tree);
    assert!(caps.can_detect_permission);
    assert!(caps.coordination_template.is_some());
}

#[test]
fn test_adapter_config() {
    let adapter = make_adapter();
    let config = adapter.config();
    assert_eq!(config.name, "Claude Code");
    assert_eq!(config.command, "claude");
    // `--no-banner` was removed upstream; built-in default_args is now empty.
    assert!(config.default_args.is_empty());
}

// ===== 思考状态检测测试 =====

#[test]
fn test_detect_thinking_spinner() {
    let adapter = make_adapter();

    // 各种 spinner 字符
    for spinner in &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] {
        let result = adapter.parse_output(spinner);
        assert!(
            result.is_some(),
            "应检测到 spinner '{}' 为思考状态",
            spinner
        );
        let new_status = extract_new_status(result.as_ref().unwrap());
        assert_eq!(
            new_status,
            Some(&AgentStatus::Thinking),
            "spinner '{}' 应映射为 Thinking 状态",
            spinner
        );
    }
}

#[test]
fn test_detect_thinking_keyword() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Thinking about the problem...");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Thinking));
}

// ===== 编码状态检测测试 =====

#[test]
fn test_detect_coding_writing() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Writing to src/main.rs");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Coding));
}

#[test]
fn test_detect_coding_editing() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Editing file.ts");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Coding));
}

#[test]
fn test_detect_coding_creating() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Creating new file components/Button.tsx");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Coding));
}

// ===== 完成状态检测测试 =====

#[test]
fn test_detect_done_checkmark() {
    let adapter = make_adapter();
    let result = adapter.parse_output("✓ All changes applied");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Done));
}

#[test]
fn test_detect_done_keyword() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Done with all tasks");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Done));
}

#[test]
fn test_detect_done_completed() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Task Completed successfully");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Done));
}

// ===== 错误状态检测测试 =====

#[test]
fn test_detect_error_keyword() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Error: something went wrong");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Error));
}

#[test]
fn test_detect_error_cross() {
    let adapter = make_adapter();
    let result = adapter.parse_output("✗ Build failed");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Error));
}

#[test]
fn test_detect_error_failed() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Command Failed with exit code 1");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Error));
}

// ===== 权限请求检测测试 =====

#[test]
fn test_detect_permission_allow() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Allow this action? [Y/n]");
    assert!(result.is_some());
    match result.unwrap() {
        ConfluxEvent::PermissionRequested {
            request, ..
        } => {
            assert!(!request.id.is_empty());
            assert!(request.description.contains("Allow"));
            assert_eq!(request.raw_context.len(), 1);
        }
        other => panic!("期望 PermissionRequested 事件，实际得到: {:?}", other),
    }
}

#[test]
fn test_detect_permission_deny() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Deny write access to /etc/passwd?");
    assert!(result.is_some());
    match result.unwrap() {
        ConfluxEvent::PermissionRequested { .. } => {}
        other => panic!("期望 PermissionRequested 事件，实际得到: {:?}", other),
    }
}

#[test]
fn test_detect_permission_do_you_want() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Do you want to proceed?");
    assert!(result.is_some());
    match result.unwrap() {
        ConfluxEvent::PermissionRequested { .. } => {}
        other => panic!("期望 PermissionRequested 事件，实际得到: {:?}", other),
    }
}

// ===== Sub-agent 事件检测测试 =====

#[test]
fn test_detect_sub_agent_spawn() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Spawning agent for subtask");
    assert!(result.is_some());
    match result.unwrap() {
        ConfluxEvent::SubAgentSpawned { sub_agent, .. } => {
            assert!(!sub_agent.id.is_empty());
            assert_eq!(sub_agent.status, AgentStatus::Idle);
        }
        other => panic!("期望 SubAgentSpawned 事件，实际得到: {:?}", other),
    }
}

#[test]
fn test_detect_sub_agent_spawn_paren() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Agent(task-123) started");
    assert!(result.is_some());
    match result.unwrap() {
        ConfluxEvent::SubAgentSpawned { .. } => {}
        other => panic!("期望 SubAgentSpawned 事件，实际得到: {:?}", other),
    }
}

#[test]
fn test_detect_sub_agent_complete() {
    let adapter = make_adapter();
    let result = adapter.parse_output("Agent completed with summary");
    assert!(result.is_some());
    match result.unwrap() {
        ConfluxEvent::SubAgentCompleted {
            result_summary, ..
        } => {
            assert!(result_summary.is_some());
        }
        other => panic!("期望 SubAgentCompleted 事件，实际得到: {:?}", other),
    }
}

#[test]
fn test_detect_sub_agent_finished() {
    let adapter = make_adapter();
    let result = adapter.parse_output("The agent finished its work");
    assert!(result.is_some());
    match result.unwrap() {
        ConfluxEvent::SubAgentCompleted { .. } => {}
        other => panic!("期望 SubAgentCompleted 事件，实际得到: {:?}", other),
    }
}

// ===== 非匹配行测试 =====

#[test]
fn test_no_match_ordinary_output() {
    let adapter = make_adapter();

    let ordinary_lines = [
        "Hello, how can I help you?",
        "Let me look at that code...",
        "The function takes two parameters.",
        "import React from 'react';",
        "fn main() { println!(\"hello\"); }",
        "",
        "   ",
        "-----",
        "Some normal text output",
    ];

    for line in &ordinary_lines {
        let result = adapter.parse_output(line);
        assert!(
            result.is_none(),
            "普通行 '{}' 不应被匹配为事件",
            line
        );
    }
}

// ===== 优先级测试 =====
// 验证当多个模式可能匹配时，高优先级的模式先匹配

#[test]
fn test_permission_takes_priority_over_status() {
    let adapter = make_adapter();
    // "Allow" 同时匹配 permission_request 和 waiting_permission
    // permission_request 应该优先匹配
    let result = adapter.parse_output("Allow this file edit?");
    assert!(result.is_some());
    match result.unwrap() {
        ConfluxEvent::PermissionRequested { .. } => {
            // 正确：权限请求优先
        }
        other => panic!(
            "期望 PermissionRequested 优先于 WaitingPermission，实际得到: {:?}",
            other
        ),
    }
}

#[test]
fn test_error_takes_priority_over_done() {
    let adapter = make_adapter();
    // "Failed" 匹配 error 模式
    let result = adapter.parse_output("Failed to complete task");
    assert!(result.is_some());
    let new_status = extract_new_status(result.as_ref().unwrap());
    assert_eq!(new_status, Some(&AgentStatus::Error));
}
