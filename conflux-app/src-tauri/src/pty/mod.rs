// ===== Conflux PTY 模块 =====
//
// 本模块负责 PTY 伪终端进程的创建、管理和输出缓冲。
// Windows 平台使用 conpty 作为底层实现（通过 portable-pty 封装）。
//
// 子模块:
//   manager — PTY 进程生命周期管理器（spawn/inject/resize/kill）
//   buffer  — 环形输出缓冲区（固定容量，超出后丢弃最旧数据）

/// PTY 进程管理器
pub mod manager;

/// PTY 输出环形缓冲区
pub mod buffer;
