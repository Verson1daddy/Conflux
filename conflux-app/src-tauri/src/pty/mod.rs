// ===== Conflux PTY 模块 =====
//
// 本模块负责 PTY 伪终端进程的创建、管理和输出缓冲。
// Windows 平台使用 conpty 作为底层实现（通过 portable-pty 封装）。
//
// 子模块:
//   manager — PTY 进程生命周期管理器（spawn/inject/resize/kill）
//   buffer  — 环形输出缓冲区（固定容量，超出后丢弃最旧数据）

/// PTY 进程管理器（旧路径，cutover ④ 删除）
pub mod manager;

/// PTY 输出环形缓冲区（旧路径，随 manager 在 cutover ④ 删除）
pub mod buffer;

/// PTY 输出状态机解析器（从输出流提取状态和事件）
pub mod parser;

// ===== cutover ③：conmux::PaneHost 接缝（设计：handoffs/cutover3_conflux_switch_design_2026-06-11.md）=====

/// MuxNotify → ConfluxEvent 事件桥（PaneEventSink 实现）
pub mod bridge;
/// conmux InjectionHook 实现（policy 闸 + fail-closed 审计下沉）
pub mod hooks;
/// 实例策略元数据表（AgentStatus/mode/hidden/parser 等策略态）
pub mod meta;
/// PaneRuntime 门面（机制态 + 策略态合并，替代 PtyManager）
pub mod runtime;
