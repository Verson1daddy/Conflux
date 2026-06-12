// ===== Conflux 适配器核心 Trait =====
// 每个 CLI 框架（Claude Code、Codex CLI、Aider 等）需实现 AgentAdapter。
// C-6（2026-06-13）：AgentInstance trait + AgentAdapter::spawn 死路径已删——
// 实例的 spawn/注入/resize/kill 全部走 conmux::PaneHost 唯一路径（经 PaneRuntime），
// adapter 只负责能力声明、输出解析与 auth 探测。

use async_trait::async_trait;

use crate::core::{AdapterCapabilities, ConfluxEvent};

/// AgentAdapter — 框架适配器核心 trait
/// 每个 CLI 框架（Claude Code、Codex CLI、Aider 等）实现此 trait
/// 负责：声明能力、解析 PTY 输出、auth 探测（进程生命周期归 PaneRuntime/conmux）
#[async_trait]
pub trait AgentAdapter: Send + Sync {
    /// 适配器唯一标识名称（如 "claude-code"、"codex-cli"）
    fn name(&self) -> &str;

    /// 获取适配器能力声明
    fn capabilities(&self) -> &AdapterCapabilities;

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
