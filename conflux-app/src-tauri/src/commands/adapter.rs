// ===== Conflux 适配器管理 Tauri 命令 =====
// 提供前端调用的适配器 CRUD 操作
// 所有命令通过 tauri::State<AppState> 访问 adapter_registry

use tauri::State;

use crate::core::{AdapterAuthStatus, AdapterConfig, AdapterId, AdapterInfo, ConfluxError};
use crate::AppState;

/// 列出所有已注册的适配器
/// 返回适配器 ID、名称、命令、能力声明、是否内置
#[tauri::command]
pub async fn list_adapters(
    state: State<'_, AppState>,
) -> Result<Vec<AdapterInfo>, ConfluxError> {
    let registry = state.adapter_registry.read();
    Ok(registry.list())
}

/// 注册自定义适配器（从 TOML 配置文件路径）
/// config_path: TOML 文件的绝对路径
/// 返回新注册的适配器 ID
#[tauri::command]
pub async fn register_adapter(
    state: State<'_, AppState>,
    config_path: String,
) -> Result<AdapterId, ConfluxError> {
    let mut registry = state.adapter_registry.write();
    let adapter_id = registry.register_from_toml(&config_path)?;
    Ok(AdapterId(adapter_id))
}

/// 获取单个适配器的详细配置
/// adapter_id: 适配器唯一标识
#[tauri::command]
pub async fn get_adapter_config(
    state: State<'_, AppState>,
    adapter_id: AdapterId,
) -> Result<AdapterConfig, ConfluxError> {
    let registry = state.adapter_registry.read();
    registry
        .get_config(&adapter_id.0)
        .cloned()
        .ok_or_else(|| ConfluxError::AdapterNotFound {
            adapter_id: adapter_id.0,
        })
}

/// 移除自定义适配器（内置适配器不可移除）
/// adapter_id: 要移除的适配器唯一标识
#[tauri::command]
pub async fn unregister_adapter(
    state: State<'_, AppState>,
    adapter_id: AdapterId,
) -> Result<(), ConfluxError> {
    let mut registry = state.adapter_registry.write();
    registry.unregister(&adapter_id.0)
}

/// 检测指定适配器的认证/登录状态
/// 调用 adapter trait 的 detect_auth() 方法判断是否已就绪
#[tauri::command]
pub async fn detect_adapter_auth(
    state: State<'_, AppState>,
    adapter_id: AdapterId,
) -> Result<AdapterAuthStatus, ConfluxError> {
    // 每个内置 adapter 的 login_command 和 docs_url 硬编码
    let (login_command, docs_url) = match adapter_id.0.as_str() {
        "claude-code" => (
            Some("claude login".to_string()),
            Some("https://docs.anthropic.com/en/docs/claude-code".to_string()),
        ),
        "codex" => (
            Some("Set OPENAI_API_KEY in your environment".to_string()),
            Some("https://platform.openai.com/docs".to_string()),
        ),
        "aider" => (
            Some("Set OPENAI_API_KEY or ANTHROPIC_API_KEY".to_string()),
            Some("https://aider.chat/docs/install.html".to_string()),
        ),
        "opencode" => (
            Some("Set ANTHROPIC_API_KEY or OPENAI_API_KEY".to_string()),
            Some("https://github.com/opencode-ai/opencode".to_string()),
        ),
        _ => (None, None),
    };

    let adapter = {
        let registry = state.adapter_registry.read();
        registry.get(&adapter_id.0).ok_or_else(|| ConfluxError::AdapterNotFound {
            adapter_id: adapter_id.0.clone(),
        })?
    };

    match adapter.detect_auth().await {
        Ok(()) => Ok(AdapterAuthStatus {
            adapter_id: adapter_id.0,
            ready: true,
            message: "Ready".to_string(),
            login_command,
            docs_url,
        }),
        Err(msg) => Ok(AdapterAuthStatus {
            adapter_id: adapter_id.0,
            ready: false,
            message: msg,
            login_command,
            docs_url,
        }),
    }
}
