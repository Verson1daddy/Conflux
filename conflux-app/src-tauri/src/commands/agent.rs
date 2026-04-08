// ===== Agent 实例管理命令层 =====
// 提供 Agent 实例的创建、销毁、查询等 Tauri IPC 命令
// 所有命令通过 tauri::State<AppState> 访问全局状态
// 依赖 BE-2 (PtyManager) 和 BE-3 (AdapterRegistry) 的具体实现

use tauri::State;

use crate::AppState;
use crate::core::{
    AdapterId, AgentInstanceInfo, AgentStateDetail, AgentStatus, AgentTree, ConfluxError,
    InstanceId,
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
    adapter_id: AdapterId,
    working_dir: Option<String>,
    args: Option<Vec<String>>,
) -> Result<AgentInstanceInfo, ConfluxError> {
    // 1. 查找适配器配置
    let adapter_config = {
        let registry = state.adapter_registry.read();
        registry
            .get_config(&adapter_id.0)
            .cloned()
            .ok_or_else(|| ConfluxError::AdapterNotFound {
                adapter_id: adapter_id.0.clone(),
            })?
    };

    // 2. 确定工作目录
    let work_dir = working_dir.unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });

    // 3. 合并启动参数
    let mut spawn_args = adapter_config.default_args.clone();
    if let Some(extra_args) = args {
        spawn_args.extend(extra_args);
    }

    // 4. 通过适配器启动 PTY 进程，获取 AgentInstance
    // TODO(BE-2/BE-3): 调用 adapter.spawn() 创建实例，注册到 pty_manager
    // 预期调用流程:
    //   let instance = adapter.spawn(&work_dir, &spawn_args).await?;
    //   let instance_id = instance.id().clone();
    //   state.pty_manager.register(instance).await?;
    // TODO(集成): adapter.spawn() + pty_manager 桥接
    // 完整流程: adapter.spawn(&work_dir, &spawn_args).await → pty_manager.register()
    return Err(ConfluxError::OrchestrationError {
        message: "Agent 实例创建尚未完成集成（等待 adapter ↔ PtyManager 桥接）".to_string(),
    });

    // 5. 记录 instance_id -> adapter_id 映射
    {
        let mut map = state.instance_adapter_map.write();
        map.insert(_instance_id.0.clone(), adapter_id.0.clone());
    }

    // 6. 构建并返回实例信息
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Ok(AgentInstanceInfo {
        instance_id: _instance_id,
        adapter_id,
        adapter_name: adapter_config.name,
        status: AgentStatus::Idle,
        working_dir: work_dir,
        is_primary_framework: false,
        created_at: now_ms,
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

    // 4. 如果是主框架实例，清除主框架引用
    {
        let mut primary = state.primary_framework.write();
        if primary.as_ref().map(|p| p == &instance_id).unwrap_or(false) {
            *primary = None;
        }
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
) -> Result<Vec<AgentInstanceInfo>, ConfluxError> {
    // TODO(BE-2/BE-3): 遍历 pty_manager 中的所有实例
    // 预期调用:
    //   let instances = state.pty_manager.list_instances();
    //   for instance in instances {
    //       let adapter_id = map.get(&instance.id().0);
    //       ...构建 AgentInstanceInfo...
    //   }
    Ok(state.pty_manager.list_instances())
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

    // 4. 检查是否为主框架
    let is_primary = {
        let primary = state.primary_framework.read();
        primary.as_ref().map(|p| p == &instance_id).unwrap_or(false)
    };

    Ok(AgentStateDetail {
        instance_id,
        adapter_id: AdapterId(adapter_id),
        adapter_name,
        status: detail.status,
        working_dir: detail.working_dir,
        is_primary_framework: is_primary,
        created_at: detail.created_at,
        last_activity_at: detail.last_activity_at,
    })
}

/// 获取 Agent 的 sub-agent 树结构
///
/// 查询指定实例的子代理层级关系，用于前端展示代理树视图。
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

    // sub-agent 树尚未集成——PtyManager 管理进程级别，
    // 树结构由 CC-1 解析器从 PTY 输出中提取（后续实现）
    // 当前返回单节点树（仅根节点，无子节点）
    let detail = state.pty_manager.get_instance_state(&instance_id.0)?;
    Ok(AgentTree {
        root: crate::core::SubAgentInfo {
            id: instance_id.0.clone(),
            name: detail.adapter_name,
            status: detail.status,
            parent_id: None,
        },
        children: Vec::new(),
    })
}
