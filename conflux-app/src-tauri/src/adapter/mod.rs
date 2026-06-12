// ===== Conflux 适配器系统 =====
// 框架适配器层——将不同 CLI 框架（Claude Code、Codex CLI、Aider 等）统一为标准接口
//
// 模块结构：
//   traits.rs     — AgentAdapter 核心 trait 定义（能力声明/输出解析/auth 探测）
//   registry.rs   — AdapterRegistry 注册表（注册、查询、管理适配器）
//   toml_parser.rs — TOML 适配器配置文件解析器
//   builtin/      — 内置适配器实现（claude_code 等）
//
// 进程生命周期（spawn/注入/kill）不在本层：全部走 conmux::PaneHost（经 PaneRuntime，C-6）。

/// 核心 trait 定义（AgentAdapter）
pub mod traits;

/// 适配器注册表
pub mod registry;

/// TOML 配置解析器
pub mod toml_parser;

/// 内置适配器
pub mod builtin;
