# Changelog — conmux

独立版本线（设计稿 §6）。承诺面（见 lib.rs Stability 节）的任何变更必须在此登记并伴随 minor bump；patch 不得破坏承诺面。

## [Unreleased]

### Fixed
- **C-2 锁纪律根治**（契约增补 §4，L-1~L-5）：`resize`/`poll_exit` 改句柄取出模式，表锁内不再等待 session 锁——单 pane 的 ConPTY 阻塞写不再冻结全 PaneHost，kill 逃生通道不再被堵；`respawn` 修 if-let 临时 guard 延寿（kill_tree 原在表锁内执行）；`spawn` 注册改 entry 防 TOCTOU（并发同 id fail-closed 终结后到者）。
- `poll_exit` 改 try_lock 探测语义：session 忙时返回 `Ok(None)`（本轮不可判定，下轮重试），顺序轮询多 pane 的消费方不被单个忙 pane 卡死。**行为变更说明**：此前 session 忙时会阻塞等待；新语义属 poll 类 API 的修正而非破坏。
- 锁外结果回写（resize 的 size / poll_exit 的 lifecycle）一律 `Arc::ptr_eq` 代际验证，respawn 产生的同 id 新 pane 不被旧代际迟到结果污染。

### Changed
- **API 收紧（M1 契约 §1.3-②）**：`pane_win` 模块降为 `pub(crate)`，crate 根不再 re-export `WindowsPaneBackend`——消费方一律经 `PaneHost::new_windows` 装配。该项属 unstable 面收紧，不破坏承诺面。
- `ConmuxError` / `MuxNotify` / `MuxPayload` 加 `#[non_exhaustive]`（§1.3-④）：未来新增变体不破坏下游编译；变体新增本身仍走 minor + changelog。
- lib.rs 新增 Stability 节（§1.3-①）：承诺面/unstable 面两档语义成文；`job` 模块四项标注 unstable。

## [0.1.0] — 2026-06-13

首个 crates.io 发布（占名 + 机制层基线）。

- 真实 ConPTY pane：spawn/inject/kill/respawn/resize/list/capture + DSR `ESC[6n` 内联应答。
- JobObject 整树监管（KILL_ON_JOB_CLOSE，fail-closed assign，Drop 即整树终结）。
- 唯一注入写链 + InjectionHook 钩子链（MF-1/2/3/5/6）。
- 行索引 scrollback + ANSI 开关捕获 + 等效全量判定。
- MuxNotify 事件流（PaneOutput seq 单调 / PaneExited 精确退出码 + 读线程代际守卫）。
- protocol.rs wire 类型冻结（deny_unknown_fields）。
- 终端主题预置注册表（六预置，蓝墨①默认）。
