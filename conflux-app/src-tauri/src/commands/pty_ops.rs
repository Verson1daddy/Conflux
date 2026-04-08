// ===== PTY 操作命令层 =====
// 提供 stdin 注入和终端尺寸调整的 Tauri IPC 命令
// 包含 StdinInjectionPolicy 安全检查（附录 B1）

use tauri::State;

use crate::AppState;
use crate::core::{ConfluxError, InstanceId, InjectionSource};

/// 向 Agent 实例的 stdin 注入内容
///
/// 注入前执行 StdinInjectionPolicy 安全检查：
/// 1. 内容长度不超过 max_injection_length
/// 2. 速率不超过 rate_limit_per_minute
/// 3. 不包含 forbidden_patterns 中的模式
///
/// # 参数
/// - `instance_id`: 目标实例标识
/// - `input`: 要注入的文本内容
/// - `source`: 注入来源分类（用于审计和策略判断）
#[tauri::command]
pub async fn inject_stdin(
    state: State<'_, AppState>,
    instance_id: InstanceId,
    input: String,
    source: Option<InjectionSource>,
) -> Result<(), ConfluxError> {
    let _source = source.unwrap_or(InjectionSource::UserDirect);

    // 1. 验证实例存在
    {
        let map = state.instance_adapter_map.read();
        if !map.contains_key(&instance_id.0) {
            return Err(ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            });
        }
    }

    // 2. 执行 StdinInjectionPolicy 安全检查
    {
        let policy = state.stdin_policy.read();

        // 长度检查
        if input.len() > policy.max_injection_length {
            return Err(ConfluxError::OrchestrationError {
                message: format!(
                    "注入内容超过最大长度限制: {} > {}",
                    input.len(),
                    policy.max_injection_length
                ),
            });
        }

        // 禁止模式检查
        for pattern in &policy.forbidden_patterns {
            if input.contains(pattern) {
                return Err(ConfluxError::OrchestrationError {
                    message: format!("注入内容包含禁止模式: '{}'", pattern),
                });
            }
        }
    }

    // 3. 速率限制检查
    {
        let mut counter = state.injection_rate_counter.write();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let window_start = now - 60; // 1 分钟窗口
        counter.retain(|&ts| ts > window_start);

        let max_rate = state.stdin_policy.read().rate_limit_per_minute;
        if counter.len() as u32 >= max_rate {
            return Err(ConfluxError::OrchestrationError {
                message: format!(
                    "注入速率超限: 过去 1 分钟内已注入 {} 次（限制 {}）",
                    counter.len(),
                    max_rate
                ),
            });
        }

        counter.push(now);
    }

    // 4. 执行注入
    state
        .pty_manager
        .inject_stdin(&instance_id.0, &input)
}

/// 调整 Agent 实例的 PTY 终端尺寸
///
/// # 参数
/// - `instance_id`: 目标实例标识
/// - `cols`: 列数
/// - `rows`: 行数
#[tauri::command]
pub async fn resize_pty(
    state: State<'_, AppState>,
    instance_id: InstanceId,
    cols: u16,
    rows: u16,
) -> Result<(), ConfluxError> {
    // 验证实例存在
    {
        let map = state.instance_adapter_map.read();
        if !map.contains_key(&instance_id.0) {
            return Err(ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            });
        }
    }

    // 执行 resize
    state.pty_manager.resize(&instance_id.0, cols, rows)
}
