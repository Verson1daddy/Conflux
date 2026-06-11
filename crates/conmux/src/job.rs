//! 进程监管抽象（API 契约 §3 / MF-4）。
//!
//! 每个 pane 一个监管器（Windows = JobObject）。本模块定义 trait 与工厂；
//! Windows `JobObjectSupervisor` 真实实现（windows-sys + KILL_ON_JOB_CLOSE +
//! fail-closed 四条款 + 禁 BREAKAWAY）在系统集成子步（V0-1/V0-5）落地。

use crate::ConmuxError;

/// 单个 pane 的进程监管器。fail-closed 四条款语义见契约 §3.1（实现侧保证）。
pub trait ProcessSupervisor: Send + Sync {
    /// 将 pid 纳入监管（Windows = AssignProcessToJobObject）。
    fn assign(&self, pid: u32) -> Result<(), ConmuxError>;
    /// 整树终结（Windows = TerminateJobObject）。
    fn kill_tree(&self) -> Result<(), ConmuxError>;
}

/// 监管器工厂：PaneHost 每次 spawn 创建一个新监管器（每 pane 一个 Job）。
///
/// 抽象成工厂而非具体类型，使 PaneHost 不绑定 Windows、便于 mock 测试机制层。
pub trait SupervisorFactory: Send + Sync {
    fn create(&self) -> Box<dyn ProcessSupervisor>;
}
