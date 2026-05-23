// ===== Conflux 适配器管理 Tauri 命令 =====
// 提供前端调用的适配器 CRUD 操作
// 所有命令通过 tauri::State<AppState> 访问 adapter_registry

use tauri::State;

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::core::{AdapterAuthStatus, AdapterConfig, AdapterId, AdapterInfo, ConfluxError};
use crate::AppState;

#[cfg(test)]
mod tests {
    use super::command_is_available_with;
    use std::ffi::OsString;
    use std::path::Path;

    #[test]
    fn command_lookup_uses_path_and_pathext() {
        let path = OsString::from(r"C:\Tools;C:\Other");
        let pathext = OsString::from(".EXE;.CMD");

        let found = command_is_available_with("codex", Some(path), Some(pathext), |candidate| {
            candidate == Path::new(r"C:\Tools\codex.EXE")
        });

        assert!(found);
    }

    #[test]
    fn command_lookup_rejects_missing_binary() {
        let path = OsString::from(r"C:\Tools;C:\Other");
        let pathext = OsString::from(".EXE;.CMD");

        let found = command_is_available_with("codex", Some(path), Some(pathext), |_| false);

        assert!(!found);
    }
}

fn command_is_available(command: &str) -> bool {
    command_is_available_with(
        command,
        env::var_os("PATH"),
        env::var_os("PATHEXT"),
        |candidate| candidate.is_file(),
    )
}

fn command_is_available_with<F>(
    command: &str,
    path_env: Option<OsString>,
    pathext_env: Option<OsString>,
    exists: F,
) -> bool
where
    F: Fn(&Path) -> bool,
{
    if command.trim().is_empty() {
        return false;
    }

    let command_path = Path::new(command);
    if command_contains_path(command) {
        return command_file_candidates(command_path, pathext_env.as_ref())
            .iter()
            .any(|candidate| exists(candidate));
    }

    let Some(path_env) = path_env else {
        return false;
    };

    let file_names = command_file_names(command, pathext_env.as_ref());
    env::split_paths(&path_env).any(|dir| {
        file_names
            .iter()
            .map(|name| dir.join(name))
            .any(|candidate| exists(&candidate))
    })
}

fn command_contains_path(command: &str) -> bool {
    command.contains('/') || command.contains('\\')
}

fn command_file_candidates(command: &Path, pathext_env: Option<&OsString>) -> Vec<PathBuf> {
    let mut candidates = vec![command.to_path_buf()];
    if command.extension().is_none() {
        for extension in executable_extensions(pathext_env) {
            candidates.push(PathBuf::from(format!("{}{}", command.display(), extension)));
        }
    }
    candidates
}

fn command_file_names(command: &str, pathext_env: Option<&OsString>) -> Vec<String> {
    let mut names = vec![command.to_string()];
    if Path::new(command).extension().is_none() {
        for extension in executable_extensions(pathext_env) {
            names.push(format!("{command}{extension}"));
        }
    }
    names
}

fn executable_extensions(pathext_env: Option<&OsString>) -> Vec<String> {
    let raw = pathext_env
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_string());

    raw.split(';')
        .map(str::trim)
        .filter(|extension| !extension.is_empty())
        .map(ToString::to_string)
        .collect()
}

/// 列出所有已注册的适配器
/// 返回适配器 ID、名称、命令、能力声明、是否内置
#[tauri::command]
pub async fn list_adapters(state: State<'_, AppState>) -> Result<Vec<AdapterInfo>, ConfluxError> {
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
    let adapter_id = {
        let mut registry = state.adapter_registry.write();
        registry.register_from_toml(&config_path)?
    };
    let sync_result = {
        let conn = state.db.lock();
        let registry = state.adapter_registry.read();
        crate::persistence::schema::sync_adapter_configs_from_registry(&conn, &registry)
    };
    if let Err(err) = sync_result {
        let mut registry = state.adapter_registry.write();
        if let Err(rollback_err) = registry.unregister(&adapter_id) {
            log::warn!("adapter registration rollback failed for {adapter_id}: {rollback_err}");
        }
        return Err(err);
    }
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

    let (adapter, command) = {
        let registry = state.adapter_registry.read();
        let adapter = registry
            .get(&adapter_id.0)
            .ok_or_else(|| ConfluxError::AdapterNotFound {
                adapter_id: adapter_id.0.clone(),
            })?;
        let command = registry
            .get_config(&adapter_id.0)
            .ok_or_else(|| ConfluxError::AdapterNotFound {
                adapter_id: adapter_id.0.clone(),
            })?
            .command
            .clone();
        (adapter, command)
    };

    let installed = command_is_available(&command);
    let install_message = if installed {
        Some(format!("Found CLI binary: {command}"))
    } else {
        Some(format!("CLI binary not found: {command}"))
    };

    if !installed {
        return Ok(AdapterAuthStatus {
            adapter_id: adapter_id.0,
            ready: false,
            message: format!("CLI binary not found: {command}"),
            login_command,
            docs_url,
            installed: false,
            authenticated: false,
            runnable: false,
            session_supported: false,
            install_message,
            auth_message: Some("Auth not checked because CLI is missing".to_string()),
            runtime_message: Some("Install the CLI before creating a session".to_string()),
            session_message: Some(
                "Session restore support is pending for V1 hardening".to_string(),
            ),
        });
    }

    match adapter.detect_auth().await {
        Ok(()) => Ok(AdapterAuthStatus {
            adapter_id: adapter_id.0,
            ready: true,
            message: "Ready".to_string(),
            login_command,
            docs_url,
            installed: true,
            authenticated: true,
            runnable: true,
            session_supported: false,
            install_message,
            auth_message: Some("Authenticated".to_string()),
            runtime_message: Some("Adapter is runnable".to_string()),
            session_message: Some(
                "Session restore support is pending for V1 hardening".to_string(),
            ),
        }),
        Err(msg) => Ok(AdapterAuthStatus {
            adapter_id: adapter_id.0,
            ready: false,
            message: msg.clone(),
            login_command,
            docs_url,
            installed: true,
            authenticated: false,
            runnable: false,
            session_supported: false,
            install_message,
            auth_message: Some(msg),
            runtime_message: Some(
                "Complete login or API key setup before creating a session".to_string(),
            ),
            session_message: Some(
                "Session restore support is pending for V1 hardening".to_string(),
            ),
        }),
    }
}

/// 设置用户收藏的适配器列表
/// adapter_ids: 收藏适配器的 ID 列表（全量覆盖）
#[tauri::command]
pub async fn set_favorite_adapters(
    state: State<'_, AppState>,
    adapter_ids: Vec<String>,
) -> Result<(), ConfluxError> {
    // 输入验证：上限 50 个，每个 ID 验证存在于 registry
    if adapter_ids.len() > 50 {
        return Err(ConfluxError::InvalidConfig {
            message: "Too many favorite adapters (max 50)".to_string(),
        });
    }
    {
        let registry = state.adapter_registry.read();
        for id in &adapter_ids {
            if registry.get_config(id).is_none() {
                return Err(ConfluxError::AdapterNotFound {
                    adapter_id: id.clone(),
                });
            }
        }
    }
    let mut favs = state.favorite_adapters.write();
    *favs = adapter_ids;
    Ok(())
}

/// 获取用户收藏的适配器列表
#[tauri::command]
pub async fn get_favorite_adapters(
    state: State<'_, AppState>,
) -> Result<Vec<String>, ConfluxError> {
    let favs = state.favorite_adapters.read();
    Ok(favs.clone())
}

/// 设置主适配器（用户默认使用的适配器）
/// adapter_id: 要设为主适配器的适配器 ID（必须已注册）
#[tauri::command]
pub async fn set_primary_adapter(
    state: State<'_, AppState>,
    adapter_id: String,
) -> Result<(), ConfluxError> {
    // 验证 adapter 存在于 registry
    {
        let registry = state.adapter_registry.read();
        if registry.get_config(&adapter_id).is_none() {
            return Err(ConfluxError::AdapterNotFound {
                adapter_id: adapter_id.clone(),
            });
        }
    }

    let mut pa = state.primary_adapter.write();
    *pa = Some(adapter_id);
    Ok(())
}

/// 获取当前主适配器
/// 返回主适配器 ID，如果未设置则返回 None
#[tauri::command]
pub async fn get_primary_adapter(
    state: State<'_, AppState>,
) -> Result<Option<String>, ConfluxError> {
    let pa = state.primary_adapter.read();
    Ok(pa.clone())
}
