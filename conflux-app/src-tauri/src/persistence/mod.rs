// ===== Conflux 持久化层 =====
// 基于 SQLite (rusqlite) 的数据持久化模块
//
// 模块结构:
//   schema  — 数据库初始化、表结构创建
//   session — 会话事件的写入与查询
//   query   — 工作台布局、讨论记录的增删改查
//
// 线程安全:
//   Connection 由上层通过 Arc<Mutex<Connection>> 持有，
//   每次操作传入 &Connection 引用，调用者负责锁管理。

/// 数据库 Schema 初始化
pub mod schema;

/// 会话事件持久化
pub mod session;

/// 通用查询（布局、讨论等）
pub mod query;

/// 控制面语义层 P1: 不可变审计事件持久化
pub mod audit;
