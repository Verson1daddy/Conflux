// ===== Conflux PTY 模块 =====
//
// PTY 机制（spawn/inject/kill/resize/scrollback/JobObject 整树监管）在 `conmux` crate
// （`crates/conmux`，机制层、不依赖 Tauri）；本模块是 conflux 策略层接缝
// （设计：handoffs/cutover3_conflux_switch_design_2026-06-11.md）。
// 旧 PtyManager/OutputBuffer 已在 cutover ④ 删除（特征测试 1:1 迁至 runtime.rs 持续绿）。

/// PTY 输出状态机解析器（从输出流提取状态和事件）
pub mod parser;

/// MuxNotify → ConfluxEvent 事件桥（PaneEventSink 实现）
pub mod bridge;
/// conmux InjectionHook 实现（policy 闸 + fail-closed 审计下沉）
pub mod hooks;
/// 实例策略元数据表（AgentStatus/mode/hidden/parser 等策略态）
pub mod meta;
/// PaneRuntime 门面（机制态 + 策略态合并视图）
pub mod runtime;
