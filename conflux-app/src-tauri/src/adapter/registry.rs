// ===== Conflux 适配器注册表 =====
// 管理所有已注册的适配器（内置 + 自定义）
// 提供注册、注销、查询、列表等操作
// 支持从 TOML 文件注册自定义适配器

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::adapter::toml_parser;
use crate::adapter::traits::AgentAdapter;
use crate::core::{AdapterConfig, AdapterId, AdapterInfo, ConfluxError};

/// 适配器注册表——发现、注册、查询适配器
pub struct AdapterRegistry {
    /// adapter_id -> Arc<dyn AgentAdapter>
    adapters: HashMap<String, Arc<dyn AgentAdapter>>,
    /// adapter_id -> AdapterConfig（用于序列化和查询）
    configs: HashMap<String, AdapterConfig>,
    /// 内置适配器 ID 集合（不可被用户移除）
    builtins: HashSet<String>,
}

impl AdapterRegistry {
    /// 创建空的注册表
    pub fn new() -> Self {
        Self {
            adapters: HashMap::new(),
            configs: HashMap::new(),
            builtins: HashSet::new(),
        }
    }

    /// 注册适配器（内置或自定义）
    /// id: 适配器唯一标识
    /// adapter: 适配器 trait 对象
    /// config: 适配器配置
    /// is_builtin: 是否为内置适配器（内置适配器不可被 unregister 移除）
    pub fn register(
        &mut self,
        id: &str,
        adapter: Arc<dyn AgentAdapter>,
        config: AdapterConfig,
        is_builtin: bool,
    ) {
        self.adapters.insert(id.to_string(), adapter);
        self.configs.insert(id.to_string(), config);
        if is_builtin {
            self.builtins.insert(id.to_string());
        }
    }

    /// 移除自定义适配器（内置适配器不可移除）
    /// 返回 Err 如果适配器不存在或是内置适配器
    pub fn unregister(&mut self, id: &str) -> Result<(), ConfluxError> {
        if !self.adapters.contains_key(id) {
            return Err(ConfluxError::AdapterNotFound {
                adapter_id: id.to_string(),
            });
        }

        if self.builtins.contains(id) {
            return Err(ConfluxError::InvalidConfig {
                message: format!("内置适配器 '{}' 不可移除", id),
            });
        }

        self.adapters.remove(id);
        self.configs.remove(id);
        Ok(())
    }

    /// 获取适配器 trait 对象
    pub fn get(&self, id: &str) -> Option<Arc<dyn AgentAdapter>> {
        self.adapters.get(id).cloned()
    }

    /// 获取适配器配置
    pub fn get_config(&self, id: &str) -> Option<&AdapterConfig> {
        self.configs.get(id)
    }

    /// 列出所有适配器信息（用于前端展示）
    pub fn list(&self) -> Vec<AdapterInfo> {
        self.configs
            .iter()
            .map(|(id, config)| AdapterInfo {
                id: AdapterId(id.clone()),
                name: config.name.clone(),
                command: config.command.clone(),
                capabilities: config.capabilities.clone(),
                is_builtin: self.builtins.contains(id),
            })
            .collect()
    }

    pub fn registered_configs(&self) -> Vec<(String, AdapterConfig, bool)> {
        let mut configs: Vec<_> = self
            .configs
            .iter()
            .map(|(id, config)| (id.clone(), config.clone(), self.builtins.contains(id)))
            .collect();
        configs.sort_by(|a, b| a.0.cmp(&b.0));
        configs
    }

    /// 从 TOML 文件注册自定义适配器
    /// config_path: TOML 配置文件路径
    /// 返回注册成功的适配器 ID
    ///
    /// 注意：自定义适配器使用通用 GenericTomlAdapter 实现，
    /// 基于 TOML 中的正则模式进行输出解析。
    pub fn register_from_toml(&mut self, config_path: &str) -> Result<String, ConfluxError> {
        let config = toml_parser::load_adapter_toml(config_path)?;

        // 使用配置中的 name 字段转换为 kebab-case 作为 adapter_id
        let adapter_id = config.name.to_lowercase().replace(' ', "-");

        // 检查是否已存在同名适配器
        if self.adapters.contains_key(&adapter_id) {
            return Err(ConfluxError::InvalidConfig {
                message: format!("适配器 '{}' 已存在", adapter_id),
            });
        }

        // 创建通用 TOML 适配器实例
        let adapter = Arc::new(GenericTomlAdapter::new(config.clone()));

        self.register(&adapter_id, adapter, config, false);

        Ok(adapter_id)
    }

    /// 检查适配器是否为内置
    pub fn is_builtin(&self, id: &str) -> bool {
        self.builtins.contains(id)
    }

    /// 获取已注册适配器数量
    pub fn count(&self) -> usize {
        self.adapters.len()
    }
}

impl Default for AdapterRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ===== 通用 TOML 适配器 =====
// 用于从 TOML 文件注册的自定义适配器
// 基于配置中的正则模式实现 parse_output

use async_trait::async_trait;
use regex::Regex;

use crate::core::{
    AdapterCapabilities, AgentStatus, ConfluxEvent, InstanceId, PermissionRequest,
    PermissionStatus, SubAgentInfo,
};

/// 通用 TOML 适配器——基于 TOML 配置中的正则模式实现输出解析
/// 用于用户通过 TOML 文件注册的自定义适配器
struct GenericTomlAdapter {
    config: AdapterConfig,
    capabilities: AdapterCapabilities,
    /// 预编译的状态检测正则
    compiled_patterns: CompiledPatterns,
}

/// 预编译的正则模式集合
struct CompiledPatterns {
    thinking: Option<Regex>,
    coding: Option<Regex>,
    done: Option<Regex>,
    error: Option<Regex>,
    waiting_permission: Option<Regex>,
    permission: Option<Regex>,
    sub_agent_spawn: Option<Regex>,
    sub_agent_complete: Option<Regex>,
}

impl CompiledPatterns {
    /// 从 AdapterConfig 编译所有正则模式
    /// 如果某个模式编译失败，记录日志并跳过（不阻断适配器注册）
    fn from_config(config: &AdapterConfig) -> Self {
        Self {
            thinking: Self::compile_optional(&config.status_patterns.thinking),
            coding: Self::compile_optional(&config.status_patterns.coding),
            done: Self::compile_optional(&config.status_patterns.done),
            error: Self::compile_optional(&config.status_patterns.error),
            waiting_permission: Self::compile_optional(&config.status_patterns.waiting_permission),
            permission: Self::compile_optional(&config.permission_pattern),
            sub_agent_spawn: Self::compile_optional(&config.sub_agent_spawn_pattern),
            sub_agent_complete: Self::compile_optional(&config.sub_agent_complete_pattern),
        }
    }

    /// 编译可选的正则模式
    fn compile_optional(pattern: &Option<String>) -> Option<Regex> {
        pattern.as_ref().and_then(|p| {
            Regex::new(p)
                .map_err(|e| {
                    log::warn!("正则模式编译失败 '{}': {}", p, e);
                    e
                })
                .ok()
        })
    }
}

impl GenericTomlAdapter {
    fn new(config: AdapterConfig) -> Self {
        let capabilities = config.capabilities.clone();
        let compiled_patterns = CompiledPatterns::from_config(&config);
        Self {
            config,
            capabilities,
            compiled_patterns,
        }
    }
}

#[async_trait]
impl AgentAdapter for GenericTomlAdapter {
    fn name(&self) -> &str {
        &self.config.name
    }

    fn capabilities(&self) -> &AdapterCapabilities {
        &self.capabilities
    }

    async fn spawn(
        &self,
        _working_dir: &str,
        _args: &[String],
    ) -> Result<Box<dyn crate::adapter::traits::AgentInstance>, ConfluxError> {
        Err(ConfluxError::InvalidConfig {
            message: "GenericTomlAdapter::spawn is not a runnable path; use create_agent_instance/PtyManager::spawn".to_string(),
        })
    }

    fn parse_output(&self, raw_line: &str) -> Option<ConfluxEvent> {
        // 使用占位 instance_id——实际运行时由调用方提供
        let placeholder_id = InstanceId("unknown".to_string());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        // 检测优先级：权限请求 > 错误 > 等待权限 > 编码 > 思考 > 完成 > sub-agent

        // 1. 权限请求检测（最高优先级）
        if let Some(ref re) = self.compiled_patterns.permission {
            if re.is_match(raw_line) {
                return Some(ConfluxEvent::PermissionRequested {
                    instance_id: placeholder_id,
                    request: PermissionRequest {
                        id: uuid::Uuid::new_v4().to_string(),
                        instance_id: InstanceId("unknown".to_string()),
                        action: "unknown".to_string(),
                        description: raw_line.to_string(),
                        raw_context: vec![raw_line.to_string()],
                        status: PermissionStatus::Pending,
                        created_at: now,
                        timeout_seconds: 120,
                        // §4.7：刮屏正则源（兜底，对 TUI 重绘不可靠）
                        signal_source: crate::core::PermissionSignalSource::Scrape,
                    },
                    timestamp: now,
                });
            }
        }

        // 2. 错误状态检测
        if let Some(ref re) = self.compiled_patterns.error {
            if re.is_match(raw_line) {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::Error,
                    timestamp: now,
                });
            }
        }

        // 3. 等待权限状态检测
        if let Some(ref re) = self.compiled_patterns.waiting_permission {
            if re.is_match(raw_line) {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::WaitingPermission,
                    timestamp: now,
                });
            }
        }

        // 4. 编码状态检测
        if let Some(ref re) = self.compiled_patterns.coding {
            if re.is_match(raw_line) {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::Coding,
                    timestamp: now,
                });
            }
        }

        // 5. 思考状态检测
        if let Some(ref re) = self.compiled_patterns.thinking {
            if re.is_match(raw_line) {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::Thinking,
                    timestamp: now,
                });
            }
        }

        // 6. 完成状态检测
        if let Some(ref re) = self.compiled_patterns.done {
            if re.is_match(raw_line) {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::Done,
                    timestamp: now,
                });
            }
        }

        // 7. Sub-agent 生成检测
        if let Some(ref re) = self.compiled_patterns.sub_agent_spawn {
            if re.is_match(raw_line) {
                return Some(ConfluxEvent::SubAgentSpawned {
                    instance_id: placeholder_id,
                    sub_agent: SubAgentInfo {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: raw_line.to_string(),
                        status: AgentStatus::Idle,
                        parent_id: None,
                    },
                    timestamp: now,
                });
            }
        }

        // 8. Sub-agent 完成检测
        if let Some(ref re) = self.compiled_patterns.sub_agent_complete {
            if re.is_match(raw_line) {
                return Some(ConfluxEvent::SubAgentCompleted {
                    instance_id: placeholder_id,
                    sub_agent_id: "unknown".to_string(),
                    result_summary: Some(raw_line.to_string()),
                    timestamp: now,
                });
            }
        }

        // 无匹配——普通输出行
        None
    }
}
