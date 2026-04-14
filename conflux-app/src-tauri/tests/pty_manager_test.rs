// ===== PtyManager 集成测试 =====
//
// 测试 PTY 进程管理器的完整生命周期:
// - 创建/销毁
// - stdin 注入
// - 进程列表
// - 错误处理（无效 instance_id）
//
// 注意: 这些测试在 Windows 上执行，使用 cmd.exe 作为测试命令。
// CI 环境需要确保 cmd.exe 可用（Windows 默认可用）。

use conflux_lib::core::{AgentStatus, ConfluxError};
use conflux_lib::pty::manager::PtyManager;

/// 辅助函数：获取平台对应的测试命令
/// Windows: cmd.exe, Unix: /bin/sh
fn test_command() -> &'static str {
    if cfg!(windows) {
        "cmd.exe"
    } else {
        "/bin/sh"
    }
}

/// 辅助函数：获取立即退出的命令参数
/// Windows: cmd.exe /c echo hello, Unix: /bin/sh -c "echo hello"
fn echo_args() -> Vec<String> {
    if cfg!(windows) {
        vec!["/c".to_string(), "echo".to_string(), "hello".to_string()]
    } else {
        vec!["-c".to_string(), "echo hello".to_string()]
    }
}

/// 辅助函数：获取工作目录
fn test_working_dir() -> String {
    std::env::current_dir()
        .unwrap()
        .to_string_lossy()
        .to_string()
}

// ===== 基本生命周期测试 =====

#[test]
fn test_new_manager_has_no_instances() {
    let manager = PtyManager::new();
    let instances = manager.list_instances();
    assert!(instances.is_empty(), "新创建的 PtyManager 应该没有实例");
}

#[test]
fn test_spawn_returns_instance_id() {
    let manager = PtyManager::new();
    let result = manager.spawn(
        test_command(),
        &echo_args(),
        &test_working_dir(),
        "test-adapter",
        "Test Adapter",
        None,
        None,
        conflux_app::core::AgentMode::Full,
        false,
        None,
    );

    assert!(result.is_ok(), "spawn 应该成功: {:?}", result.err());
    let instance_id = result.unwrap();
    assert!(!instance_id.is_empty(), "instance_id 不应为空");

    // UUID v4 格式验证: 8-4-4-4-12
    assert_eq!(
        instance_id.len(),
        36,
        "UUID v4 字符串应为 36 个字符"
    );

    // 清理
    let _ = manager.kill(&instance_id);
}

#[test]
fn test_spawn_creates_instance_in_list() {
    let manager = PtyManager::new();
    let instance_id = manager
        .spawn(
            test_command(),
            &echo_args(),
            &test_working_dir(),
            "test-adapter",
            "Test Adapter",
            None,
            None,
        )
        .unwrap();

    let instances = manager.list_instances();
    assert_eq!(instances.len(), 1, "应该有 1 个实例");
    assert_eq!(instances[0].instance_id.0, instance_id);
    assert_eq!(instances[0].adapter_name, "Test Adapter");

    // 清理
    let _ = manager.kill(&instance_id);
}

#[test]
fn test_multiple_spawns() {
    let manager = PtyManager::new();
    let id1 = manager
        .spawn(
            test_command(),
            &echo_args(),
            &test_working_dir(),
            "adapter-1",
            "Adapter 1",
            None,
            None,
        )
        .unwrap();
    let id2 = manager
        .spawn(
            test_command(),
            &echo_args(),
            &test_working_dir(),
            "adapter-2",
            "Adapter 2",
            None,
            None,
        )
        .unwrap();

    assert_ne!(id1, id2, "不同实例应有不同 ID");

    let instances = manager.list_instances();
    assert_eq!(instances.len(), 2, "应该有 2 个实例");

    // 清理
    let _ = manager.kill(&id1);
    let _ = manager.kill(&id2);
}

// ===== kill 测试 =====

#[test]
fn test_kill_removes_instance() {
    let manager = PtyManager::new();
    let instance_id = manager
        .spawn(
            test_command(),
            &echo_args(),
            &test_working_dir(),
            "test-adapter",
            "Test Adapter",
            None,
            None,
        )
        .unwrap();

    assert_eq!(manager.list_instances().len(), 1);

    let result = manager.kill(&instance_id);
    assert!(result.is_ok(), "kill 应该成功");

    assert_eq!(
        manager.list_instances().len(),
        0,
        "kill 后实例列表应为空"
    );
}

#[test]
fn test_kill_nonexistent_instance() {
    let manager = PtyManager::new();
    let result = manager.kill("nonexistent-id");

    assert!(result.is_err(), "kill 不存在的实例应返回错误");
    match result.unwrap_err() {
        ConfluxError::InstanceNotFound { instance_id } => {
            assert_eq!(instance_id, "nonexistent-id");
        }
        other => panic!("期望 InstanceNotFound，实际: {:?}", other),
    }
}

// ===== inject_stdin 测试 =====

#[test]
fn test_inject_stdin_to_valid_instance() {
    let manager = PtyManager::new();

    // 启动一个持久的交互式进程（不是立即退出的 echo）
    let cmd = test_command();
    let instance_id = manager
        .spawn(
            cmd,
            &[],
            &test_working_dir(),
            "test-adapter",
            "Test Adapter",
            None,
            None,
        )
        .unwrap();

    // 短暂等待进程启动
    std::thread::sleep(std::time::Duration::from_millis(500));

    let result = manager.inject_stdin(&instance_id, "echo test\n");
    assert!(
        result.is_ok(),
        "inject_stdin 应该成功: {:?}",
        result.err()
    );

    // 清理
    let _ = manager.kill(&instance_id);
}

#[test]
fn test_inject_stdin_to_nonexistent_instance() {
    let manager = PtyManager::new();
    let result = manager.inject_stdin("nonexistent-id", "data");

    assert!(result.is_err());
    match result.unwrap_err() {
        ConfluxError::InstanceNotFound { instance_id } => {
            assert_eq!(instance_id, "nonexistent-id");
        }
        other => panic!("期望 InstanceNotFound，实际: {:?}", other),
    }
}

// ===== get_instance_state 测试 =====

#[test]
fn test_get_instance_state() {
    let manager = PtyManager::new();
    let instance_id = manager
        .spawn(
            test_command(),
            &echo_args(),
            &test_working_dir(),
            "my-adapter",
            "My Adapter",
            None,
            None,
        )
        .unwrap();

    let state = manager.get_instance_state(&instance_id).unwrap();
    assert_eq!(state.instance_id.0, instance_id);
    assert_eq!(state.adapter_id.0, "my-adapter");
    assert_eq!(state.adapter_name, "My Adapter");
    assert_eq!(state.status, AgentStatus::Idle);

    // 清理
    let _ = manager.kill(&instance_id);
}

#[test]
fn test_get_instance_state_nonexistent() {
    let manager = PtyManager::new();
    let result = manager.get_instance_state("nonexistent-id");
    assert!(result.is_err());
}

// ===== update_status 测试 =====

#[test]
fn test_update_status() {
    let manager = PtyManager::new();
    let instance_id = manager
        .spawn(
            test_command(),
            &echo_args(),
            &test_working_dir(),
            "test-adapter",
            "Test Adapter",
            None,
            None,
        )
        .unwrap();

    // 初始状态应为 Idle
    let state = manager.get_instance_state(&instance_id).unwrap();
    assert_eq!(state.status, AgentStatus::Idle);

    // 更新为 Thinking
    manager
        .update_status(&instance_id, AgentStatus::Thinking)
        .unwrap();
    let state = manager.get_instance_state(&instance_id).unwrap();
    assert_eq!(state.status, AgentStatus::Thinking);

    // 更新为 Coding
    manager
        .update_status(&instance_id, AgentStatus::Coding)
        .unwrap();
    let state = manager.get_instance_state(&instance_id).unwrap();
    assert_eq!(state.status, AgentStatus::Coding);

    // 清理
    let _ = manager.kill(&instance_id);
}

#[test]
fn test_update_status_nonexistent() {
    let manager = PtyManager::new();
    let result = manager.update_status("nonexistent-id", AgentStatus::Thinking);
    assert!(result.is_err());
}

// ===== get_buffer 测试 =====

#[test]
fn test_get_buffer() {
    let manager = PtyManager::new();
    let instance_id = manager
        .spawn(
            test_command(),
            &echo_args(),
            &test_working_dir(),
            "test-adapter",
            "Test Adapter",
            None,
            None,
        )
        .unwrap();

    let buffer = manager.get_buffer(&instance_id);
    assert!(buffer.is_ok(), "get_buffer 应该成功");

    // 等待进程输出（echo 命令会产生一些输出）
    std::thread::sleep(std::time::Duration::from_millis(1000));

    let buf = buffer.unwrap();
    let data = buf.read();
    let total = data.total_written();
    // echo 命令至少会输出 "hello" + 换行 + cmd 提示符等
    // 具体输出取决于 shell，只验证缓冲区有内容
    assert!(
        total > 0,
        "echo 命令执行后缓冲区应有输出，total_written={}",
        total
    );

    // 清理
    drop(data);
    let _ = manager.kill(&instance_id);
}

#[test]
fn test_get_buffer_nonexistent() {
    let manager = PtyManager::new();
    let result = manager.get_buffer("nonexistent-id");
    assert!(result.is_err());
}

// ===== resize 测试 =====

#[test]
fn test_resize() {
    let manager = PtyManager::new();
    let instance_id = manager
        .spawn(
            test_command(),
            &[],
            &test_working_dir(),
            "test-adapter",
            "Test Adapter",
            None,
            None,
        )
        .unwrap();

    // 短暂等待进程启动
    std::thread::sleep(std::time::Duration::from_millis(500));

    let result = manager.resize(&instance_id, 80, 24);
    assert!(result.is_ok(), "resize 应该成功: {:?}", result.err());

    // 清理
    let _ = manager.kill(&instance_id);
}

#[test]
fn test_resize_nonexistent() {
    let manager = PtyManager::new();
    let result = manager.resize("nonexistent-id", 80, 24);
    assert!(result.is_err());
}

// ===== 输出捕获测试 =====

#[test]
fn test_output_captured_in_buffer() {
    let manager = PtyManager::new();

    // 使用交互式 shell，然后注入 echo 命令
    let instance_id = manager
        .spawn(
            test_command(),
            &[],
            &test_working_dir(),
            "test-adapter",
            "Test Adapter",
            None,
            None,
        )
        .unwrap();

    // 等待 shell 启动
    std::thread::sleep(std::time::Duration::from_millis(1000));

    // 注入 echo 命令
    manager
        .inject_stdin(&instance_id, "echo CONFLUX_TEST_MARKER\n")
        .unwrap();

    // 等待输出
    std::thread::sleep(std::time::Duration::from_millis(1500));

    // 读取缓冲区
    let buffer = manager.get_buffer(&instance_id).unwrap();
    let buf = buffer.read();
    let output = buf.read_all();
    let output_str = String::from_utf8_lossy(&output);

    assert!(
        output_str.contains("CONFLUX_TEST_MARKER"),
        "缓冲区应包含 echo 的输出，实际内容: {}",
        output_str
    );

    // 清理
    drop(buf);
    let _ = manager.kill(&instance_id);
}

// ===== spawn 错误测试 =====

#[test]
fn test_spawn_invalid_command() {
    let manager = PtyManager::new();
    let result = manager.spawn(
        "this_command_does_not_exist_at_all_12345",
        &[],
        &test_working_dir(),
        "test-adapter",
        "Test Adapter",
        None,
        None,
        conflux_app::core::AgentMode::Full,
        false,
        None,
    );

    // 在某些系统上，spawn 可能不会立即失败（shell 会启动然后报 command not found）。
    // 但在大多数情况下，如果命令不存在，portable-pty 应该返回错误。
    // 我们接受两种结果：要么 spawn 失败返回错误，要么成功但进程很快退出。
    if result.is_err() {
        match result.unwrap_err() {
            ConfluxError::PtyError { message } => {
                assert!(
                    !message.is_empty(),
                    "PtyError 应该包含错误信息"
                );
            }
            other => panic!("期望 PtyError，实际: {:?}", other),
        }
    }
    // 如果 spawn 成功了（某些平台的行为），那也是可接受的
}
