// ===== Agent 实例管理命令层 =====
// 提供 Agent 实例的创建、销毁、查询等 Tauri IPC 命令
// 所有命令通过 tauri::State<AppState> 访问全局状态
// 依赖 BE-2 (PtyManager) 和 BE-3 (AdapterRegistry) 的具体实现

use std::sync::Arc;

use tauri::State;

use crate::AppState;
use crate::core::event_emit::emit_conflux_event;
use crate::core::{
    AdapterId, AgentInstanceInfo, AgentMode, AgentStateDetail, AgentStatus, AgentTree,
    ConfluxError, ConfluxEvent, InstanceId,
};

/// 创建 Agent 实例
///
/// 根据 adapter_id 查找已注册的适配器，通过该适配器启动一个新的 PTY 进程，
/// 并将实例信息记录到全局状态中。
///
/// # 参数
/// - `adapter_id`: 要使用的适配器标识
/// - `working_dir`: 工作目录（可选，默认使用当前目录）
/// - `args`: 额外启动参数（可选）
///
/// # 返回
/// 新创建的 Agent 实例信息
#[tauri::command]
pub async fn create_agent_instance(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    adapter_id: AdapterId,
    working_dir: Option<String>,
    args: Option<Vec<String>>,
    mode: Option<AgentMode>,
    hidden: Option<bool>,
    display_name: Option<String>,
) -> Result<AgentInstanceInfo, ConfluxError> {
    // 1. 查找适配器配置 + 获取 adapter trait 对象
    let (adapter_config, adapter_arc) = {
        let registry = state.adapter_registry.read();
        let config = registry
            .get_config(&adapter_id.0)
            .cloned()
            .ok_or_else(|| ConfluxError::AdapterNotFound {
                adapter_id: adapter_id.0.clone(),
            })?;
        let adapter = registry.get(&adapter_id.0).ok_or_else(|| {
            ConfluxError::AdapterNotFound {
                adapter_id: adapter_id.0.clone(),
            }
        })?;
        (config, adapter)
    };

    // 2. 确定工作目录
    let work_dir = working_dir.unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });

    // 3. 确定运行模式（B3.1 Contract 1）
    let agent_mode = mode.unwrap_or(AgentMode::Full);
    let is_hidden = hidden.unwrap_or(false);

    // 4. 合并启动参数：default_args + mode-specific args + extra args
    let mut spawn_args = adapter_config.default_args.clone();
    match agent_mode {
        AgentMode::Sandbox => spawn_args.extend(adapter_config.sandbox_args.clone()),
        AgentMode::Full => spawn_args.extend(adapter_config.full_args.clone()),
    }
    if let Some(extra_args) = args {
        spawn_args.extend(extra_args);
    }

    // 5. 构造事件派发器——PTY 读取线程内的 parser 会通过它把解析出的
    //    ConfluxEvent 路由到 Tauri 前端。AppHandle clone 进闭包，让线程可以
    //    在 command 函数返回后继续使用。
    let app_handle = app.clone();
    let dispatcher: crate::pty::manager::EventDispatcher =
        Arc::new(move |event: &ConfluxEvent| {
            emit_conflux_event(&app_handle, event);
        });

    // 6. 通过 PtyManager 启动 PTY 进程（带事件流）
    // Normalize: treat empty string as None
    let normalized_name = display_name.filter(|s| !s.trim().is_empty());

    let instance_id_str = state.pty_manager.spawn(
        &adapter_config.command,
        &spawn_args,
        &work_dir,
        &adapter_id.0,
        &adapter_config.name,
        Some(adapter_arc),
        Some(dispatcher),
        agent_mode.clone(),
        is_hidden,
        normalized_name.clone(),
    )?;

    let instance_id = InstanceId(instance_id_str);

    // 7. 记录 instance_id -> adapter_id 映射
    {
        let mut map = state.instance_adapter_map.write();
        map.insert(instance_id.0.clone(), adapter_id.0.clone());
    }

    // 8. 构建并返回实例信息
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Ok(AgentInstanceInfo {
        instance_id,
        adapter_id,
        adapter_name: adapter_config.name,
        display_name: normalized_name,
        status: AgentStatus::Idle,
        working_dir: work_dir,
        is_pinned: false,
        created_at: now_ms,
        mode: agent_mode,
        hidden: is_hidden,
    })
}

/// 销毁 Agent 实例
///
/// 终止指定实例的 PTY 进程，清理所有关联资源和状态映射。
///
/// # 参数
/// - `instance_id`: 要销毁的实例标识
#[tauri::command]
pub async fn destroy_agent_instance(
    state: State<'_, AppState>,
    instance_id: InstanceId,
) -> Result<(), ConfluxError> {
    // 1. 验证实例存在
    {
        let map = state.instance_adapter_map.read();
        if !map.contains_key(&instance_id.0) {
            return Err(ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            });
        }
    }

    // 2. 终止 PTY 进程
    // TODO(BE-2): 通过 pty_manager 获取实例并调用 kill()
    // 预期调用:
    //   let instance = state.pty_manager.get(&instance_id)?;
    //   instance.kill().await?;
    //   state.pty_manager.remove(&instance_id)?;
    // TODO(集成): pty_manager.kill(&instance_id.0)
    state.pty_manager.kill(&instance_id.0)?;

    // 3. 清理实例映射
    {
        let mut map = state.instance_adapter_map.write();
        map.remove(&instance_id.0);
    }

    // 4. 从钉选集合中移除（如果存在）
    {
        let mut pinned = state.pinned_instances.write();
        pinned.remove(&instance_id.0);
    }

    Ok(())
}

/// 列出所有活跃 Agent 实例
///
/// 遍历当前所有已注册的实例，构建实例信息列表返回。
///
/// # 返回
/// 所有活跃实例的信息列表
#[tauri::command]
pub async fn list_agent_instances(
    state: State<'_, AppState>,
    include_hidden: Option<bool>,
) -> Result<Vec<AgentInstanceInfo>, ConfluxError> {
    let mut all = state.pty_manager.list_instances();

    // Merge pin state from AppState (PtyManager always returns is_pinned=false)
    {
        let pinned = state.pinned_instances.read();
        for inst in &mut all {
            inst.is_pinned = pinned.contains(&inst.instance_id.0);
        }
    }

    if include_hidden.unwrap_or(false) {
        Ok(all)
    } else {
        Ok(all.into_iter().filter(|inst| !inst.hidden).collect())
    }
}

/// 重命名 Agent 实例（设置用户自定义别名）
///
/// # 参数
/// - `instance_id`: 实例 ID
/// - `display_name`: 新别名，传 null 或空字符串清除别名
#[tauri::command]
pub async fn rename_agent_instance(
    state: State<'_, AppState>,
    instance_id: InstanceId,
    display_name: Option<String>,
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

    let normalized = display_name.filter(|s| !s.trim().is_empty());
    state.pty_manager.rename_instance(&instance_id.0, normalized)?;

    log::debug!("Agent 实例重命名: {}", instance_id.0);
    Ok(())
}

/// 查询单个 Agent 实例的详细状态
///
/// 获取指定实例的完整状态信息，包括运行状态、工作目录、创建时间等。
///
/// # 参数
/// - `instance_id`: 要查询的实例标识
///
/// # 返回
/// 实例的详细状态信息
#[tauri::command]
pub async fn get_agent_state(
    state: State<'_, AppState>,
    instance_id: InstanceId,
) -> Result<AgentStateDetail, ConfluxError> {
    // 1. 查找适配器映射
    let adapter_id = {
        let map = state.instance_adapter_map.read();
        map.get(&instance_id.0)
            .cloned()
            .ok_or_else(|| ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            })?
    };

    // 2. 获取适配器名称
    let adapter_name = {
        let registry = state.adapter_registry.read();
        registry
            .get_config(&adapter_id)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| "unknown".to_string())
    };

    // 3. 获取实例运行状态
    // TODO(BE-2): 通过 pty_manager 获取实例并读取状态
    // 预期调用:
    //   let instance = state.pty_manager.get(&instance_id)?;
    //   let agent_state = instance.get_state();
    let detail = state.pty_manager.get_instance_state(&instance_id.0)?;

    // 4. 检查是否为钉选
    let is_pinned = {
        let pinned = state.pinned_instances.read();
        pinned.contains(&instance_id.0)
    };

    Ok(AgentStateDetail {
        instance_id,
        adapter_id: AdapterId(adapter_id),
        adapter_name,
        display_name: detail.display_name,
        status: detail.status,
        working_dir: detail.working_dir,
        is_pinned,
        created_at: detail.created_at,
        last_activity_at: detail.last_activity_at,
        mode: detail.mode,
        hidden: detail.hidden,
    })
}

/// 获取 Agent 的 sub-agent 树结构
///
/// B3 契约 2：委托给 PtyManager::get_agent_tree，从共享 parser 中读取
/// 实时的 AgentTree（包含 sub-agent 层级）。
///
/// # 参数
/// - `instance_id`: 要查询的实例标识
///
/// # 返回
/// 以该实例为根节点的代理树结构
#[tauri::command]
pub async fn get_agent_tree(
    state: State<'_, AppState>,
    instance_id: InstanceId,
) -> Result<AgentTree, ConfluxError> {
    // 1. 验证实例存在
    {
        let map = state.instance_adapter_map.read();
        if !map.contains_key(&instance_id.0) {
            return Err(ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            });
        }
    }

    // 2. 委托给 PtyManager，从共享 parser 中读取 AgentTree
    state.pty_manager.get_agent_tree(&instance_id.0)
}

/// C2-T1 Exit Overlay · respawn 模式——restart 原 agent 或切换到 shell
///
/// 用于 ExitOverlay 的三个按钮中的两个：
/// - `"restart"`: 用原 adapter_id 重启 claude（复用同一个 instance_id）
/// - `"shell"`:   把同一个 instance_id 切换成 powershell.exe，用户可以跑
///                 任意 shell 命令（git / ls / 再次跑 claude 等）
///
/// Close Card 走前端现有的 destroy_agent_instance + removeCard 路径，
/// 不经过此命令。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RespawnMode {
    /// 用原 adapter_id 重启同一种 agent
    Restart,
    /// 切换到 powershell（Windows）/ bash（未来平台），保留同一 instance_id
    Shell,
}

/// Respawn 后的 "shell" 适配器假名——instance_adapter_map 里用它
/// 标记该实例当前挂的是 shell 而不是真 adapter。
const SHELL_ADAPTER_PSEUDO_ID: &str = "__shell__";

/// C2-T1 Exit Overlay · 重启 Agent 或切换到 Shell（复用 instance_id）
///
/// # 参数
/// - `instance_id`: 要 respawn 的实例 ID（保留给 UI 的 card）
/// - `mode`: 重启模式（restart / shell）
///
/// # 返回
/// 新的 AgentInstanceInfo（instance_id 和传入一致）
///
/// # Errors
/// - `AdapterNotFound`: restart 模式下找不到原 adapter（不应发生，除非 unregister 过）
/// - `PtyError`: spawn 新 PTY 失败
#[tauri::command]
pub async fn respawn_agent_instance(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    instance_id: InstanceId,
    mode: RespawnMode,
) -> Result<AgentInstanceInfo, ConfluxError> {
    // 1. 从原 instance_adapter_map 查旧 adapter_id —— restart 模式需要它来
    //    查 adapter_config + adapter trait 对象。shell 模式用不上但还是记录。
    let original_adapter_id = {
        let map = state.instance_adapter_map.read();
        map.get(&instance_id.0).cloned()
    };

    // 1b. 先读取旧实例的 working_dir / mode / hidden —— 必须在 pty_manager.respawn 之前读，
    //     因为 respawn 内部会先 kill 旧实例，之后 get_instance_state 就查
    //     不到原 cwd 了。C2-T1 review 发现的 bug（先拿再删）。
    let preserved_detail = state
        .pty_manager
        .get_instance_state(&instance_id.0)
        .ok();
    let preserved_work_dir = preserved_detail.as_ref().map(|d| d.working_dir.clone());
    let preserved_mode = preserved_detail.as_ref().map(|d| d.mode.clone()).unwrap_or(AgentMode::Full);
    let preserved_hidden = preserved_detail.as_ref().map(|d| d.hidden).unwrap_or(false);
    let preserved_display_name = preserved_detail.as_ref().and_then(|d| d.display_name.clone());

    // 2. 根据模式确定 command / args / adapter_id / adapter_name / adapter_trait
    let (command, args, new_adapter_id, new_adapter_name, adapter_arc_opt) = match mode {
        RespawnMode::Restart => {
            let orig = original_adapter_id.clone().ok_or_else(|| {
                ConfluxError::InstanceNotFound {
                    instance_id: instance_id.0.clone(),
                }
            })?;
            let (config, adapter_arc) = {
                let registry = state.adapter_registry.read();
                let config = registry.get_config(&orig).cloned().ok_or_else(|| {
                    ConfluxError::AdapterNotFound {
                        adapter_id: orig.clone(),
                    }
                })?;
                let adapter = registry.get(&orig).ok_or_else(|| {
                    ConfluxError::AdapterNotFound {
                        adapter_id: orig.clone(),
                    }
                })?;
                (config, adapter)
            };
            (
                config.command.clone(),
                config.default_args.clone(),
                orig,
                config.name.clone(),
                Some(adapter_arc),
            )
        }
        RespawnMode::Shell => {
            // Windows: 默认 powershell.exe。未来 macOS/Linux 可以切 bash。
            // 不传任何 parser（adapter trait = None）——shell 里没有状态检测
            // pattern 的概念，parser 会被跳过。
            let shell_cmd = if cfg!(windows) {
                "powershell.exe".to_string()
            } else {
                "bash".to_string()
            };
            (
                shell_cmd,
                Vec::<String>::new(),
                SHELL_ADAPTER_PSEUDO_ID.to_string(),
                "Shell".to_string(),
                None,
            )
        }
    };

    // 3. 工作目录：延续原实例的 cwd（respawn 是"就地复活"语义）。
    //    如果 1b 没拿到（旧实例已经被前端 kill 或 ProcessExited 后 reap），
    //    fallback 到 Conflux 进程自己的 cwd。
    let work_dir = preserved_work_dir.unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });

    // 4. 构造 dispatcher——和 create_agent_instance 一致
    let app_handle = app.clone();
    let dispatcher: crate::pty::manager::EventDispatcher =
        Arc::new(move |event: &crate::core::ConfluxEvent| {
            emit_conflux_event(&app_handle, event);
        });

    // 5. 通过 PtyManager::respawn spawn 新 child（复用 instance_id）
    state.pty_manager.respawn(
        &instance_id.0,
        &command,
        &args,
        &work_dir,
        &new_adapter_id,
        &new_adapter_name,
        adapter_arc_opt,
        Some(dispatcher),
        preserved_mode.clone(),
        preserved_hidden,
        preserved_display_name.clone(),
    )?;

    // 6. 更新 instance_adapter_map —— shell 模式会写入 "__shell__"
    {
        let mut map = state.instance_adapter_map.write();
        map.insert(instance_id.0.clone(), new_adapter_id.clone());
    }

    // 7. 返回新的 AgentInstanceInfo
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Ok(AgentInstanceInfo {
        instance_id,
        adapter_id: AdapterId(new_adapter_id),
        adapter_name: new_adapter_name,
        display_name: preserved_display_name,
        status: AgentStatus::Idle,
        working_dir: work_dir,
        is_pinned: false,
        created_at: now_ms,
        mode: preserved_mode,
        hidden: preserved_hidden,
    })
}

/// 切换运行中 Agent 实例的权限模式（B3.1 Contract 3）
///
/// 实现方式：kill 当前进程 -> 用新 mode 的参数 respawn -> 保留原 instance_id。
/// 这复用了 respawn_agent_instance 的 Restart 路径，但切换 args。
///
/// # 参数
/// - `instance_id`: 目标实例
/// - `mode`: 新的运行模式 (full / sandbox)
///
/// # 返回
/// 更新后的 AgentInstanceInfo（instance_id 不变，mode 已更新）
///
/// # 注意
/// 切换模式会重启进程，当前会话上下文会丢失。
/// 前端应在切换前警告用户。
#[tauri::command]
pub async fn set_agent_mode(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    instance_id: InstanceId,
    mode: AgentMode,
) -> Result<AgentInstanceInfo, ConfluxError> {
    // 1. Look up adapter_id from instance_adapter_map
    let adapter_id = {
        let map = state.instance_adapter_map.read();
        map.get(&instance_id.0).cloned().ok_or_else(|| {
            ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            }
        })?
    };

    // 2. Get adapter config + trait object
    let (adapter_config, adapter_arc) = {
        let registry = state.adapter_registry.read();
        let config = registry.get_config(&adapter_id).cloned().ok_or_else(|| {
            ConfluxError::AdapterNotFound {
                adapter_id: adapter_id.clone(),
            }
        })?;
        let adapter = registry.get(&adapter_id).ok_or_else(|| {
            ConfluxError::AdapterNotFound {
                adapter_id: adapter_id.clone(),
            }
        })?;
        (config, adapter)
    };

    // 3. Read preserved working_dir, hidden, display_name BEFORE kill
    let detail = state.pty_manager.get_instance_state(&instance_id.0).ok();
    let work_dir = detail
        .as_ref()
        .map(|d| d.working_dir.clone())
        .unwrap_or_else(|| ".".to_string());
    let is_hidden = detail.as_ref().map(|d| d.hidden).unwrap_or(false);
    let preserved_name = detail.as_ref().and_then(|d| d.display_name.clone());

    // 4. Build args with new mode
    let mut spawn_args = adapter_config.default_args.clone();
    match mode {
        AgentMode::Sandbox => spawn_args.extend(adapter_config.sandbox_args.clone()),
        AgentMode::Full => spawn_args.extend(adapter_config.full_args.clone()),
    }

    // 5. Build dispatcher
    let app_handle = app.clone();
    let dispatcher: crate::pty::manager::EventDispatcher =
        Arc::new(move |event: &ConfluxEvent| {
            emit_conflux_event(&app_handle, event);
        });

    // 6. Respawn with same instance_id but new args
    state.pty_manager.respawn(
        &instance_id.0,
        &adapter_config.command,
        &spawn_args,
        &work_dir,
        &adapter_id,
        &adapter_config.name,
        Some(adapter_arc),
        Some(dispatcher),
        mode.clone(),
        is_hidden,
        preserved_name.clone(),
    )?;

    // 7. Build and return updated instance info
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Ok(AgentInstanceInfo {
        instance_id,
        adapter_id: AdapterId(adapter_id),
        adapter_name: adapter_config.name,
        display_name: preserved_name,
        status: AgentStatus::Idle,
        working_dir: work_dir,
        is_pinned: false,
        created_at: now_ms,
        mode,
        hidden: is_hidden,
    })
}

/// C2-T1 exit 检测 · 前端轮询
///
/// 双重检测：先查 reader_done flag，再调 child.try_wait()。
/// 即使 ConPTY reader 永远不 break，try_wait 也能可靠检测进程退出。
#[tauri::command]
pub async fn is_process_exited(
    state: State<'_, AppState>,
    instance_id: InstanceId,
) -> Result<bool, ConfluxError> {
    state.pty_manager.is_process_exited(&instance_id.0)
}

/// 获取指定实例 PTY OutputBuffer 的历史内容（base64 编码）
///
/// # 用途
/// 解决"卡片预览 vs 展开态不同步"的问题：PtyManager 会把每一批 PTY
/// 输出实时 emit `conflux://pty-output` 事件，但 xterm 只能接收 mount
/// 之后到达的事件。ExpandedAgentCard 在用户双击卡片时才 mount，此时
/// PTY 可能已经吐出了大量内容，expanded 的 xterm 完全看不到历史。
///
/// 前端 XtermTerminal 在 mount 时先调用这个命令把 OutputBuffer 里的
/// 全部历史拉回来写进 terminal，然后再订阅实时事件流，就能保证预览
/// 和详情两边看到的内容一致。
///
/// # Returns
/// base64 编码的原始 PTY 字节流（用 base64 是为了让 IPC 能安全传输
/// 任意 ANSI escape code + 二进制字节，不被 JSON 序列化破坏）。
///
/// # Errors
/// - `InstanceNotFound`: 指定的 instance_id 不存在
#[tauri::command]
pub async fn get_pty_history(
    state: State<'_, AppState>,
    instance_id: InstanceId,
) -> Result<String, ConfluxError> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    let buffer_arc = state.pty_manager.get_buffer(&instance_id.0)?;
    let buffer = buffer_arc.read();
    let bytes = buffer.read_all();
    Ok(BASE64.encode(&bytes))
}
