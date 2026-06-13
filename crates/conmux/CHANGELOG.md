# Changelog — conmux

独立版本线（设计稿 §6）。承诺面（见 lib.rs Stability 节）的任何变更必须在此登记并伴随 minor bump；patch 不得破坏承诺面。

## [Unreleased]

### Added
- **M2a daemon IPC 地基**（命名管道 + 单二进制 CLI，"关窗不死"承重墙的第一阶段）：
  - **协议增补**（承诺面，D-4/D-8）：`MuxOp` 增 `Respawn`/`Subscribe`/`Unsubscribe`/`Attach`/
    `ListThemes`/`SetTheme`/`KillServer`；`MuxPayload` 增 `Subscribed`/`Unsubscribed`/
    `AttachSnapshot`/`Themes`/`ThemeSet`/`ServerKillScheduled`；新增帧信封 `WireFrame`
    （`Hello`/`HelloAck`/`Request`/`Reply`/`Notify`，`deny_unknown_fields` + H-2 方向约束）
    + `PROTOCOL_VERSION=1`；`MuxNotify` 补 `Serialize`/`Deserialize`（`PaneOutput.data` base64
    适配）+ `ThemeChanged` 变体；`ConmuxError::Unsupported`。
  - **wire 帧编码** `wire` 模块（D-4）：`u32 LE 长度 + JSON`，4 MiB 上限（超大长度先拒不预分配），
    EOF 区分帧边界优雅关闭 vs 截断。
  - **命名管道传输** `pipe` 模块（仅 Windows，I-1..I-5）：服务端首实例 `FILE_FLAG_FIRST_PIPE_INSTANCE`
    抢注守卫（失败不降级）+ DACL 仅授权当前用户 SID + `PIPE_REJECT_REMOTE_CLIENTS` + 客户端身份取数。
  - **daemon** `daemon` 模块（仅 Windows）：管道监听 + 握手（版本严格相等）+ dispatcher（经 `PaneHost`，
    R-1 `Send`→`inject_stdin`、R-2 IPC 注入硬编码 `UserDirect`）+ KillServer + I-5 身份 fail-closed
    + H-2 帧方向约束 + H-3 panic 隔离。`Subscribe`/`Attach`/`SetTheme` 返回 `Unsupported`（行为留 M2b/M2c）。
  - **client** `client` 模块（仅 Windows）：连接 + 自动拉起（`CreateProcessW` `bInheritHandles=FALSE`
    防 stdio 句柄泄漏）+ 握手 + 请求-应答。
  - **CLI 二进制** `conmux`：`daemon`/`new`/`ls`/`send`/`capture`/`kill`/`resize`/`respawn`/`kill-server`
    （手搓 arg 解析，不引 clap）。`serde_json` 自 dev 提升为生产依赖。
- **VT 私有模式跟踪 + 重放前导**（M2 重放架构第一块砖，spike 实证裁决）：读泵增量跟踪
  DECSET/DECRST 模态位（alt-screen 族 / `?25` 光标可见性 / `?1` DECCKM / 鼠标
  `?1000/1002/1003/1006` / `?2004` bracketed paste，跨 chunk 撕裂容错）；新增承诺面方法
  `PaneHost::mode_preamble(pane_id) -> Vec<u8>` 合成 attach 重放前导。重放协议 =
  前导 + capture 字节；ring 任意起点重放下文本/光标自愈、模态位由前导恢复。

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
