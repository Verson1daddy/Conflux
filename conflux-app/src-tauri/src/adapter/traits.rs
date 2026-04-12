// ===== Conflux 适配器核心 Trait =====
// 定义 AgentAdapter 和 AgentInstance 两个核心 trait
// 每个 CLI 框架（Claude Code、Codex CLI、Aider 等）需实现 AgentAdapter
// AgentInstance 代表一个运行中的 Agent 实例（由 spawn() 创建）

use async_trait::async_trait;

use crate::core::{
    AdapterCapabilities, AgentState, AgentTree, ConfluxError, ConfluxEvent, InstanceId,
};

/// AgentAdapter — 框架适配器核心 trait
/// 每个 CLI 框架（Claude Code、Codex CLI、Aider 等）实现此 trait
/// 负责：声明能力、启动实例、解析 PTY 输出
#[async_trait]
pub trait AgentAdapter: Send + Sync {
    /// 适配器唯一标识名称（如 "claude-code"、"codex-cli"）
    fn name(&self) -> &str;

    /// 获取适配器能力声明
    fn capabilities(&self) -> &AdapterCapabilities;

    /// 启动一个框架实例，返回 AgentInstance
    /// working_dir: 工作目录路径
    /// args: 额外启动参数
    async fn spawn(
        &self,
        working_dir: &str,
        args: &[String],
    ) -> Result<Box<dyn AgentInstance>, ConfluxError>;

    /// 解析 PTY 输出行，提取结构化事件
    /// 返回 None 表示该行无特殊含义（普通输出）
    /// 返回 Some(event) 表示检测到了有意义的事件（状态变更、权限请求等）
    fn parse_output(&self, raw_line: &str) -> Option<ConfluxEvent>;

    /// 检测当前系统上该 adapter 是否已登录/配置好 credentials。
    /// 返回 Ok(()) 表示 ready，Err(message) 表示需要登录或配置。
    /// 默认实现返回 Ok(())（适用于自定义 TOML adapter 或无需 auth 的场景）。
    async fn detect_auth(&self) -> Result<(), String> {
        Ok(())
    }
}

/// AgentInstance — 单个运行中的 Agent 实例
/// 由 AgentAdapter::spawn() 创建
/// 提供实例级别的操作：stdin 注入、状态查询、终端调整、进程终止
#[async_trait]
pub trait AgentInstance: Send + Sync {
    /// 实例唯一 ID
    fn id(&self) -> &InstanceId;

    /// 向实例的 stdin 注入内容
    async fn inject_stdin(&self, input: &str) -> Result<(), ConfluxError>;

    /// 获取当前 Agent 状态
    fn get_state(&self) -> AgentState;

    /// 获取 sub-agent 树结构
    fn get_tree(&self) -> AgentTree;

    /// 调整终端尺寸
    async fn resize(&self, cols: u16, rows: u16) -> Result<(), ConfluxError>;

    /// 终止进程并清理资源
    async fn kill(&self) -> Result<(), ConfluxError>;

    /// 获取所属适配器名称
    fn adapter_name(&self) -> &str;
}
