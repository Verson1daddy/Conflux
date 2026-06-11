// ===== Conflux 编排层 =====
// 管理多 Agent 讨论、上下文聚合、主框架协调
//
// 模块结构:
//   discussion   — 讨论引擎：管理活跃讨论的生命周期和消息流
//   context      — 上下文聚合器：从多个 Agent 实例聚合产出摘要
//   coordinator  — 主框架协调器：构建调度指令、判断触发时机

/// 讨论引擎
pub mod discussion;

/// 上下文聚合器
pub mod context;

/// 主框架协调器
pub mod coordinator;

/// 控制面语义层 P2: 注意力队列引擎（AttentionItem + AttentionQueue）
pub mod attention;

/// V1-core: 注意力队列 sweeper 线程（超时 Expired + defer 提醒复活）
pub mod sweeper;
