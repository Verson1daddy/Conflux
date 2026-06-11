// ===== Conflux PTY 进程管理器 =====
//
// 核心职责:
//   管理所有 Agent 实例的 PTY 进程生命周期。
//   每个 Agent 实例对应一个 PTY 进程（Windows 上使用 conpty）。
//
// Windows conpty 创建流程:
//   1. native_pty_system() — 获取当前平台的 PTY 系统实现（Windows 上返回 conpty）
//   2. pty_system.openpty(size) — 创建 master/slave pair
//   3. CommandBuilder::new(command) — 构建要执行的命令
//   4. slave.spawn_command(cmd) — 在 slave 端执行命令，返回 child 进程句柄
//   5. master.try_clone_reader() — 克隆 reader 用于后台输出读取线程
//   6. master.try_clone_writer() — 获取 writer 用于 stdin 注入
//   7. std::thread::spawn — 启动后台线程持续读取 master 输出到 OutputBuffer
//
// 线程安全:
//   PtyManager 内部使用 parking_lot::RwLock 保护 processes HashMap。
//   所有公开方法接收 &self（不是 &mut self），通过锁控制并发访问。
//   OutputBuffer 通过 Arc<RwLock<OutputBuffer>> 在读取线程和外部消费者之间共享。

use std::collections::HashMap;
use std::io::Read as IoRead;
use std::io::Write as IoWrite;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use parking_lot::RwLock;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

use crate::adapter::traits::AgentAdapter;
use crate::core::{
    AdapterId, AgentInstanceInfo, AgentMode, AgentStateDetail, AgentStatus, AgentTree,
    ConfluxError, ConfluxEvent, InstanceId, SubAgentInfo,
};
use crate::pty::buffer::{OutputBuffer, DEFAULT_BUFFER_CAPACITY};
use crate::pty::parser::PtyOutputParser;

/// 事件分发器类型别名——由 PtyManager::spawn 的调用者（生产代码）传入，
/// 用于把 PTY 读取线程解析出来的 ConfluxEvent 派发到 Tauri 前端。
/// 测试场景传 `None` 跳过事件派发，只写 OutputBuffer。
pub type EventDispatcher = Arc<dyn Fn(&ConfluxEvent) + Send + Sync>;

/// 默认 PTY 终端尺寸：120 列 x 30 行
const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;

/// 输出读取线程的缓冲区大小（每次 read 调用的最大字节数）
const READ_CHUNK_SIZE: usize = 8192;

/// Resolve a command name to a launchable executable on Windows.
///
/// Windows' `CreateProcessW` only accepts PE-format executables; it does NOT
/// consult `PATHEXT` the way `cmd.exe` does. When a Node.js CLI like
/// `@anthropic-ai/claude-code` is installed via `npm -g`, three shims are
/// created in the same folder:
///
///   claude          (bash shim — not a PE executable, fails with error 193)
///   claude.cmd      (batch file — launchable via CreateProcessW)
///   claude.ps1      (PowerShell script — requires pwsh.exe)
///
/// If we naively pass `"claude"` to `portable_pty`, it hits the bash shim
/// first and dies with `os error 193`. This helper walks `PATH` + `PATHEXT`
/// manually and returns the first `.cmd` / `.exe` / `.bat` match so we hand
/// `CommandBuilder` a real launchable path. Returns the original string
/// unchanged on non-Windows or when no match is found (so the caller still
/// gets a clear error from spawn).
#[cfg(windows)]
fn resolve_windows_command(command: &str) -> String {
    use std::path::{Path, PathBuf};

    let path = Path::new(command);

    // Already an absolute path with a recognized extension that exists — keep as-is.
    if path.is_absolute() && path.extension().is_some() && path.exists() {
        return command.to_string();
    }

    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    let extensions: Vec<String> = pathext
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    // Directories to scan: if the caller gave an absolute path (possibly
    // without extension), look in its parent folder; otherwise walk PATH.
    let candidate_dirs: Vec<PathBuf> = if path.is_absolute() {
        match path.parent() {
            Some(parent) => vec![parent.to_path_buf()],
            None => return command.to_string(),
        }
    } else if path.components().count() > 1 {
        // Relative with directory segments — scan relative to cwd's parent.
        match path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => vec![parent.to_path_buf()],
            _ => vec![],
        }
    } else {
        std::env::var("PATH")
            .unwrap_or_default()
            .split(';')
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .collect()
    };

    let basename = path.file_stem().and_then(|s| s.to_str()).unwrap_or(command);

    for dir in &candidate_dirs {
        for ext in &extensions {
            let candidate = dir.join(format!("{}{}", basename, ext));
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }

    // No match — fall through to the original command so the spawn error
    // message still surfaces the actual name the user configured.
    command.to_string()
}

#[cfg(not(windows))]
fn resolve_windows_command(command: &str) -> String {
    command.to_string()
}

/// PTY 进程管理器——管理所有 Agent 实例的 PTY 进程
///
/// 生命周期:
/// 1. spawn() — 创建 conpty 进程，启动输出读取线程
/// 2. inject_stdin() — 向进程 stdin 写入数据
/// 3. resize() — 调整终端尺寸
/// 4. kill() — 终止进程并清理资源
pub struct PtyManager {
    /// instance_id -> PtyProcess 映射表
    processes: RwLock<HashMap<String, PtyProcess>>,
}

/// 单个 PTY 进程的运行时状态
struct PtyProcess {
    /// portable-pty 的 child 进程句柄
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// stdin writer（用于 inject_stdin）— Mutex 包裹以满足 Sync 要求
    writer: parking_lot::Mutex<Box<dyn IoWrite + Send>>,
    /// 输出缓冲区（与读取线程共享）
    buffer: Arc<RwLock<OutputBuffer>>,
    /// 创建时间（Unix 时间戳 ms）
    created_at: i64,
    /// 最后活动时间（Unix 时间戳 ms），由 reader/input/status 路径更新
    last_activity_at: Arc<AtomicI64>,
    /// 结束时间（Unix 时间戳 ms）；0 表示仍在运行
    ended_at: Arc<AtomicI64>,
    /// 适配器 ID
    adapter_id: String,
    /// 适配器名称
    adapter_name: String,
    /// 用户自定义别名
    display_name: Option<String>,
    /// 工作目录
    working_dir: String,
    /// 当前 Agent 状态
    status: AgentStatus,
    /// PTY 尺寸
    pty_size: PtySize,
    /// master pty handle（用于 resize 操作）— Mutex 包裹以满足 Sync 要求
    master_pty: parking_lot::Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    /// C2-T1 备用 exit 检测：读取线程在 break 后设为 true。
    /// 用于 `is_process_exited` 命令做前端轮询——belt-and-suspenders,
    /// 因为 Windows ConPTY 的 reader 有时在 child exit 后不返回 EOF。
    reader_done: Arc<AtomicBool>,
    /// B3 契约 2：共享 parser 引用（用于 get_agent_tree 查询 AgentTree）。
    /// 当 adapter 存在且 dispatch 启用时创建，shell 模式下为 None。
    parser: Option<Arc<parking_lot::Mutex<PtyOutputParser>>>,
    /// 实例运行模式（sandbox / full）（B3.1 Contract 1）
    mode: AgentMode,
    /// 是否为隐藏实例（讨论 sandbox 创建的实例不在工作台显示）（B3.1 Contract 1）
    hidden: bool,
}

/// 获取当前时间戳（Unix 毫秒）
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn atomic_optional_timestamp(value: &AtomicI64) -> Option<i64> {
    match value.load(Ordering::Acquire) {
        0 => None,
        timestamp => Some(timestamp),
    }
}

impl PtyManager {
    /// 创建新的 PTY 进程管理器（进程映射表为空）
    pub fn new() -> Self {
        log::debug!("PtyManager 初始化");
        Self {
            processes: RwLock::new(HashMap::new()),
        }
    }

    /// 创建新 PTY 进程
    ///
    /// # Arguments
    /// * `command` - 要执行的命令（例如 "claude"、"cmd.exe"）
    /// * `args` - 命令参数
    /// * `working_dir` - 工作目录
    /// * `adapter_id` - 所属适配器 ID
    /// * `adapter_name` - 适配器显示名称
    ///
    /// # Returns
    /// 成功返回 instance_id（UUID v4 字符串）
    ///
    /// # Windows conpty 创建流程
    /// 1. `native_pty_system()` 获取系统 PTY 实现
    /// 2. `openpty(size)` 创建 master/slave pair
    /// 3. `CommandBuilder` 构建命令（设置工作目录和参数）
    /// 4. `slave.spawn_command()` 在 slave 上执行
    /// 5. 启动后台线程读取 master 输出 -> OutputBuffer
    ///
    /// # 可选事件流
    /// - `adapter`: 当传入 Some 时，读取线程会创建 PtyOutputParser 使用
    ///   该 adapter 做行级解析，产生 ConfluxEvent（AgentStatusChanged /
    ///   TaskCompleted / PermissionRequested / SubAgent 等）。
    /// - `dispatch`: 当传入 Some 时，解析出的事件会通过此回调派发（生产代
    ///   码里通常是 `emit_conflux_event` 的闭包）。同时每次读取都会 emit
    ///   一条 PtyOutput 事件（base64 原始字节），供 XtermTerminal 订阅。
    /// - 两个参数都为 None 时（测试场景），spawn 行为回退到仅写 OutputBuffer。
    pub fn spawn(
        &self,
        command: &str,
        args: &[String],
        working_dir: &str,
        adapter_id: &str,
        adapter_name: &str,
        adapter: Option<Arc<dyn AgentAdapter>>,
        dispatch: Option<EventDispatcher>,
        mode: AgentMode,
        hidden: bool,
        display_name: Option<String>,
    ) -> Result<String, ConfluxError> {
        let instance_id = uuid::Uuid::new_v4().to_string();
        self.spawn_inner(
            instance_id,
            command,
            args,
            working_dir,
            adapter_id,
            adapter_name,
            adapter,
            dispatch,
            mode,
            hidden,
            display_name,
        )
    }

    /// 用调用方预生成的 `instance_id` 启动 PTY（A.2 hook 修复需要：先知道 id 才能把
    /// per-instance hook 文件路径写进 `--settings`，再 spawn）。薄包装 `spawn_inner`。
    ///
    /// 调用方须保证 `instance_id` 当前不在 processes map 里（与 spawn_inner 同约束）。
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_with_id(
        &self,
        instance_id: String,
        command: &str,
        args: &[String],
        working_dir: &str,
        adapter_id: &str,
        adapter_name: &str,
        adapter: Option<Arc<dyn AgentAdapter>>,
        dispatch: Option<EventDispatcher>,
        mode: AgentMode,
        hidden: bool,
        display_name: Option<String>,
    ) -> Result<String, ConfluxError> {
        self.spawn_inner(
            instance_id,
            command,
            args,
            working_dir,
            adapter_id,
            adapter_name,
            adapter,
            dispatch,
            mode,
            hidden,
            display_name,
        )
    }

    /// 用指定的 `instance_id` 启动一个 PTY 进程（C2-T1 Exit Overlay 需要 respawn 复用同一个 id）。
    ///
    /// 调用者必须自己保证 `instance_id` 当前不在 processes map 里——否则后续
    /// `insert` 会覆盖掉旧 entry 而不 drop 它，造成 child handle 泄漏。
    /// 正常使用路径是：`respawn()` 内部先 kill 旧 entry 再调这个方法。
    #[allow(clippy::too_many_arguments)]
    fn spawn_inner(
        &self,
        instance_id: String,
        command: &str,
        args: &[String],
        working_dir: &str,
        adapter_id: &str,
        adapter_name: &str,
        adapter: Option<Arc<dyn AgentAdapter>>,
        dispatch: Option<EventDispatcher>,
        mode: AgentMode,
        hidden: bool,
        display_name: Option<String>,
    ) -> Result<String, ConfluxError> {
        log::debug!(
            "PTY spawn 开始: instance_id={}, command={}, working_dir={}",
            instance_id,
            command,
            working_dir
        );

        // 1. 获取系统 PTY 实现（Windows 上为 conpty）
        let pty_system = native_pty_system();

        // 2. 创建 master/slave pair
        let default_size = PtySize {
            cols: DEFAULT_PTY_COLS,
            rows: DEFAULT_PTY_ROWS,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system.openpty(default_size).map_err(|e| {
            log::error!("PTY openpty 失败: {}", e);
            ConfluxError::PtyError {
                message: format!("openpty 失败: {}", e),
            }
        })?;

        // 3. 构建命令 — Windows 下先把命令名解析为带扩展的绝对路径，
        //    避开 npm-global 下的 bash shim（见 resolve_windows_command 文档）。
        let resolved_command = resolve_windows_command(command);
        if resolved_command != command {
            log::debug!("PTY spawn 路径解析: {} -> {}", command, resolved_command);
        }
        let mut cmd = CommandBuilder::new(&resolved_command);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.cwd(working_dir);

        // 4. 在 slave 上执行命令
        let child = pair.slave.spawn_command(cmd).map_err(|e| {
            log::error!(
                "PTY spawn_command 失败: command={}, resolved={}, error={}",
                command,
                resolved_command,
                e
            );
            ConfluxError::PtyError {
                message: format!(
                    "spawn_command 失败 (command={}, resolved={}): {}",
                    command, resolved_command, e
                ),
            }
        })?;

        // 释放 slave——spawn 之后不再需要 slave 端
        drop(pair.slave);

        // 5. 获取 reader 和 writer
        let mut reader = pair.master.try_clone_reader().map_err(|e| {
            log::error!("PTY try_clone_reader 失败: {}", e);
            ConfluxError::PtyError {
                message: format!("try_clone_reader 失败: {}", e),
            }
        })?;

        let writer = pair.master.take_writer().map_err(|e| {
            log::error!("PTY take_writer 失败: {}", e);
            ConfluxError::PtyError {
                message: format!("take_writer 失败: {}", e),
            }
        })?;

        // 6. 创建输出缓冲区 + exit 标记
        let created_at = now_millis();
        let buffer = Arc::new(RwLock::new(OutputBuffer::new(DEFAULT_BUFFER_CAPACITY)));
        let buffer_clone = Arc::clone(&buffer);
        let reader_done = Arc::new(AtomicBool::new(false));
        let reader_done_clone = Arc::clone(&reader_done);
        let last_activity_at = Arc::new(AtomicI64::new(created_at));
        let last_activity_at_clone = Arc::clone(&last_activity_at);
        let ended_at = Arc::new(AtomicI64::new(0));
        let ended_at_clone = Arc::clone(&ended_at);
        let thread_instance_id = instance_id.clone();
        let thread_adapter_id = adapter_id.to_string();

        // 7. 创建共享 parser（adapter + dispatch 都 Some 时才启用）
        //
        // B3 契约 2：parser 需要在主线程和读取线程之间共享——
        // 读取线程 feed 数据，主线程通过 get_agent_tree 查询 AgentTree。
        let shared_parser: Option<Arc<parking_lot::Mutex<PtyOutputParser>>> = adapter
            .as_ref()
            .filter(|_| dispatch.is_some())
            .map(|adapter_arc| {
                Arc::new(parking_lot::Mutex::new(PtyOutputParser::new(
                    InstanceId(instance_id.clone()),
                    Arc::clone(adapter_arc),
                    adapter_name,
                )))
            });
        let thread_parser = shared_parser.clone();

        // 8. 启动后台线程持续读取 PTY 输出
        //
        // 生产路径：如果同时提供 adapter + dispatch，线程使用共享 PtyOutputParser，
        // 把每批原始字节 feed 进去 → 取出 ConfluxEvent → 通过 dispatch 回调推给
        // Tauri 前端；同时额外 emit 一条 PtyOutput 事件（base64 编码原始字节），
        // XtermTerminal 的 subscribeToPty 模式会订阅它逐块 write。
        // 测试路径：adapter/dispatch 任一为 None 时只写 OutputBuffer（旧行为）。
        std::thread::spawn(move || {
            log::debug!("PTY 输出读取线程启动: instance_id={}", thread_instance_id);

            let mut chunk = vec![0u8; READ_CHUNK_SIZE];
            // Tracks the reason the reader loop finally exits so we can
            // emit a meaningful signal string with ProcessExited.
            // "normal"  = Ok(0) EOF — child closed its side of the PTY
            // "reader"  = read returned Err — pipe broken (kill / crash)
            let exit_reason: &str = loop {
                match reader.read(&mut chunk) {
                    Ok(0) => {
                        log::debug!(
                            "PTY 输出读取线程结束（进程退出）: instance_id={}",
                            thread_instance_id
                        );
                        break "normal";
                    }
                    Ok(n) => {
                        let now_ms = now_millis();
                        last_activity_at_clone.store(now_ms, Ordering::Release);
                        {
                            let mut buf = buffer_clone.write();
                            buf.write(&chunk[..n]);
                        }

                        // 事件派发——PtyOutput 只需要 dispatch，不依赖 parser。
                        // Shell 模式下 adapter=None → parser=None，但 PTY 输出
                        // 仍然必须到达 xterm。把 PtyOutput emit 提到 parser guard 外面。
                        if let Some(dispatch_ref) = dispatch.as_ref() {
                            // 1. 原始 PTY 输出（XtermTerminal subscribeToPty 使用）
                            let encoded = BASE64.encode(&chunk[..n]);
                            let pty_output_event = ConfluxEvent::PtyOutput {
                                instance_id: InstanceId(thread_instance_id.clone()),
                                data: encoded,
                                timestamp: now_ms,
                            };
                            dispatch_ref(&pty_output_event);

                            // 2. 结构化事件解析（仅当有共享 parser 时——shell 跳过）
                            if let Some(parser_arc) = thread_parser.as_ref() {
                                let mut parser_guard = parser_arc.lock();
                                let events = parser_guard.feed(&chunk[..n]);
                                drop(parser_guard); // 释放锁再 dispatch
                                for event in &events {
                                    dispatch_ref(event);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::debug!(
                            "PTY 输出读取线程结束（读取错误）: instance_id={}, error={}",
                            thread_instance_id,
                            e
                        );
                        break "reader";
                    }
                }
            };

            let ended_ms = now_millis();
            last_activity_at_clone.store(ended_ms, Ordering::Release);
            ended_at_clone.store(ended_ms, Ordering::Release);

            // C2-T1: surface the exit to the frontend so ExitOverlay can
            // offer Restart / Open Shell / Close Card. We can't easily
            // wait(&mut child) from here because the child handle lives in
            // the main thread's PtyProcess — follow-up ticket will wire a
            // try_wait polling layer for the precise exit_code. For now
            // the frontend only needs the fact that it exited.
            if let Some(dispatch_ref) = dispatch.as_ref() {
                let signal = if exit_reason == "reader" {
                    Some("pipe_broken".to_string())
                } else {
                    None
                };
                let exit_event = ConfluxEvent::ProcessExited {
                    instance_id: InstanceId(thread_instance_id.clone()),
                    adapter_id: thread_adapter_id.clone(),
                    exit_code: None,
                    signal,
                    timestamp: ended_ms,
                };
                dispatch_ref(&exit_event);
            }

            // Mark reader as done so the polling fallback
            // (is_process_exited command) can detect exit even if the
            // ConPTY event was swallowed or the reader hung and then
            // eventually broke.
            reader_done_clone.store(true, Ordering::Release);
            log::info!(
                "PTY reader_done flag set: instance_id={}",
                thread_instance_id
            );
        });

        // 9. 构建 PtyProcess 并存入映射表
        let process = PtyProcess {
            child,
            writer: parking_lot::Mutex::new(writer),
            buffer,
            reader_done,
            created_at,
            last_activity_at,
            ended_at,
            adapter_id: adapter_id.to_string(),
            adapter_name: adapter_name.to_string(),
            display_name,
            working_dir: working_dir.to_string(),
            status: AgentStatus::Idle,
            pty_size: default_size,
            master_pty: parking_lot::Mutex::new(pair.master),
            parser: shared_parser,
            mode,
            hidden,
        };

        {
            let mut processes = self.processes.write();
            processes.insert(instance_id.clone(), process);
        }

        log::debug!("PTY spawn 完成: instance_id={}", instance_id);
        Ok(instance_id)
    }

    /// 修改实例的用户自定义别名
    pub fn rename_instance(
        &self,
        instance_id: &str,
        display_name: Option<String>,
    ) -> Result<(), ConfluxError> {
        let mut processes = self.processes.write();
        let process =
            processes
                .get_mut(instance_id)
                .ok_or_else(|| ConfluxError::InstanceNotFound {
                    instance_id: instance_id.to_string(),
                })?;
        process.display_name = display_name;
        process
            .last_activity_at
            .store(now_millis(), Ordering::Release);
        Ok(())
    }

    /// 向指定实例的 stdin 注入内容
    ///
    /// 将 input 字符串以 UTF-8 字节写入 PTY 进程的 stdin。
    /// 调用者负责在 input 末尾添加换行符（如果需要）。
    pub fn inject_stdin(&self, instance_id: &str, input: &str) -> Result<(), ConfluxError> {
        let processes = self.processes.read();
        let process = processes
            .get(instance_id)
            .ok_or_else(|| ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            })?;

        let mut writer = process.writer.lock();
        writer
            .write_all(input.as_bytes())
            .map_err(|e| ConfluxError::PtyError {
                message: format!("stdin 写入失败 (instance_id={}): {}", instance_id, e),
            })?;

        writer.flush().map_err(|e| ConfluxError::PtyError {
            message: format!("stdin flush 失败 (instance_id={}): {}", instance_id, e),
        })?;

        process
            .last_activity_at
            .store(now_millis(), Ordering::Release);

        log::debug!(
            "inject_stdin 完成: instance_id={}, length={}",
            instance_id,
            input.len()
        );
        Ok(())
    }

    /// 调整终端尺寸
    ///
    /// 通知 conpty 后端调整窗口大小，使终端应用能正确重排输出。
    pub fn resize(&self, instance_id: &str, cols: u16, rows: u16) -> Result<(), ConfluxError> {
        let mut processes = self.processes.write();
        let process =
            processes
                .get_mut(instance_id)
                .ok_or_else(|| ConfluxError::InstanceNotFound {
                    instance_id: instance_id.to_string(),
                })?;

        let new_size = PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        };

        let master = process.master_pty.lock();
        master
            .resize(new_size)
            .map_err(|e| ConfluxError::PtyError {
                message: format!(
                    "resize 失败 (instance_id={}, {}x{}): {}",
                    instance_id, cols, rows, e
                ),
            })?;
        drop(master);

        process.pty_size = new_size;
        process
            .last_activity_at
            .store(now_millis(), Ordering::Release);

        log::debug!(
            "resize 完成: instance_id={}, cols={}, rows={}",
            instance_id,
            cols,
            rows
        );
        Ok(())
    }

    /// C2-T1 Exit Overlay · 重新 spawn 一个子进程，复用原 instance_id
    ///
    /// 典型场景：Claude 进程退出后用户在 ExitOverlay 点 Restart / Open Shell，
    /// 前端希望卡片原地复活（id / 布局 / z_index 都不变，只是底层 PTY 换了）。
    ///
    /// 流程：
    /// 1. 尝试 kill 旧 PtyProcess（如果还在 map 里）。如果已经被前端 close 或
    ///    自然 exit，则直接跳过 kill，不是错误。
    /// 2. 用 spawn_inner 重新 spawn，复用原 instance_id 作为 HashMap 的 key。
    /// 3. 返回 instance_id（和传入一致）。
    ///
    /// 调用者要负责更新 instance_adapter_map 里 instance_id -> adapter_id 的映射
    /// —— 在 shell 模式下 adapter_id 会变（变成 "shell"），restart 模式下不变。
    #[allow(clippy::too_many_arguments)]
    pub fn respawn(
        &self,
        instance_id: &str,
        command: &str,
        args: &[String],
        working_dir: &str,
        adapter_id: &str,
        adapter_name: &str,
        adapter: Option<Arc<dyn AgentAdapter>>,
        dispatch: Option<EventDispatcher>,
        mode: AgentMode,
        hidden: bool,
        display_name: Option<String>,
    ) -> Result<String, ConfluxError> {
        // 1. 如果 map 里还有旧 entry，先 kill。kill 失败不 fatal——child 可能
        //    已经自然退出或被前端先 close 过，此时直接 spawn 新的即可。
        let had_old = {
            let processes = self.processes.read();
            processes.contains_key(instance_id)
        };
        if had_old {
            if let Err(e) = self.kill(instance_id) {
                log::warn!(
                    "respawn: kill old instance failed (继续 spawn 新的): instance_id={}, error={:?}",
                    instance_id,
                    e
                );
            }
        }

        // 2. 用指定 id spawn 新 child
        self.spawn_inner(
            instance_id.to_string(),
            command,
            args,
            working_dir,
            adapter_id,
            adapter_name,
            adapter,
            dispatch,
            mode,
            hidden,
            display_name,
        )
    }

    /// 终止进程并清理资源
    ///
    /// 向 child 进程发送终止信号，然后从映射表中移除。
    /// 后台输出读取线程会因管道断开而自动退出。
    pub fn kill(&self, instance_id: &str) -> Result<(), ConfluxError> {
        // 1. 从映射表移除（持有写锁的时间最短化）
        let mut process = {
            let mut processes = self.processes.write();
            processes
                .remove(instance_id)
                .ok_or_else(|| ConfluxError::InstanceNotFound {
                    instance_id: instance_id.to_string(),
                })?
        };
        // 写锁已释放——后续操作不阻塞其他 PtyManager 方法

        // 2. 发送终止信号
        if let Err(e) = process.child.kill() {
            log::error!(
                "PTY kill 失败（可能进程已退出）: instance_id={}, error={}",
                instance_id,
                e
            );
        }

        // 3. 等待进程退出以回收资源（此时不持有任何锁）
        // 即使 wait 阻塞或失败，进程已从映射表移除，资源最终由 Drop 回收
        let _ = process.child.wait();

        log::debug!("PTY kill 完成: instance_id={}", instance_id);
        Ok(())
    }

    /// 列出所有活跃实例
    ///
    /// 返回当前所有 PTY 进程的基本信息列表。
    /// is_pinned 字段始终为 false（由上层 AppState 管理）。
    pub fn list_instances(&self) -> Vec<AgentInstanceInfo> {
        let processes = self.processes.read();
        processes
            .iter()
            .map(|(id, proc)| AgentInstanceInfo {
                instance_id: InstanceId(id.clone()),
                adapter_id: AdapterId(proc.adapter_id.clone()),
                adapter_name: proc.adapter_name.clone(),
                display_name: proc.display_name.clone(),
                status: proc.status.clone(),
                working_dir: proc.working_dir.clone(),
                is_pinned: false, // 由 AppState 层管理，list_agent_instances 会 merge
                created_at: proc.created_at,
                last_activity_at: proc.last_activity_at.load(Ordering::Acquire),
                ended_at: atomic_optional_timestamp(&proc.ended_at),
                mode: proc.mode.clone(),
                hidden: proc.hidden,
            })
            .collect()
    }

    /// 获取指定实例的状态详情
    ///
    /// is_pinned 字段始终为 false（由上层 AppState 管理）。
    pub fn get_instance_state(&self, instance_id: &str) -> Result<AgentStateDetail, ConfluxError> {
        let processes = self.processes.read();
        let process = processes
            .get(instance_id)
            .ok_or_else(|| ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            })?;

        Ok(AgentStateDetail {
            instance_id: InstanceId(instance_id.to_string()),
            adapter_id: AdapterId(process.adapter_id.clone()),
            adapter_name: process.adapter_name.clone(),
            display_name: process.display_name.clone(),
            status: process.status.clone(),
            working_dir: process.working_dir.clone(),
            is_pinned: false, // 由 AppState 层管理
            created_at: process.created_at,
            last_activity_at: process.last_activity_at.load(Ordering::Acquire),
            ended_at: atomic_optional_timestamp(&process.ended_at),
            mode: process.mode.clone(),
            hidden: process.hidden,
            sub_agents: self
                .get_agent_tree(instance_id)
                .map(|tree| {
                    fn recurse(
                        node: &crate::core::types::AgentTree,
                        out: &mut Vec<crate::core::SubAgentInfo>,
                    ) {
                        for child in &node.children {
                            out.push(child.root.clone());
                            recurse(child, out);
                        }
                    }
                    let mut result = Vec::new();
                    recurse(&tree, &mut result);
                    result
                })
                .unwrap_or_default(),
        })
    }

    /// 获取 Agent 的 sub-agent 树结构
    ///
    /// B3 契约 2：从共享 parser 中读取 AgentTree。
    /// 如果没有 parser（shell 模式），返回仅含 root 节点的单节点树。
    pub fn get_agent_tree(&self, instance_id: &str) -> Result<AgentTree, ConfluxError> {
        let processes = self.processes.read();
        let process = processes
            .get(instance_id)
            .ok_or_else(|| ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            })?;

        match &process.parser {
            Some(parser_arc) => {
                let parser = parser_arc.lock();
                Ok(parser.get_tree())
            }
            None => Ok(AgentTree {
                root: SubAgentInfo {
                    id: instance_id.to_string(),
                    name: process.adapter_name.clone(),
                    status: process.status.clone(),
                    parent_id: None,
                },
                children: Vec::new(),
            }),
        }
    }

    /// 更新实例的 Agent 状态（由解析器调用）
    ///
    /// 适配器解析器在检测到状态变化后调用此方法更新状态。
    pub fn update_status(
        &self,
        instance_id: &str,
        status: AgentStatus,
    ) -> Result<(), ConfluxError> {
        let mut processes = self.processes.write();
        let process =
            processes
                .get_mut(instance_id)
                .ok_or_else(|| ConfluxError::InstanceNotFound {
                    instance_id: instance_id.to_string(),
                })?;

        log::debug!(
            "状态更新: instance_id={}, {:?} -> {:?}",
            instance_id,
            process.status,
            status
        );
        process.status = status;
        process
            .last_activity_at
            .store(now_millis(), Ordering::Release);
        Ok(())
    }

    /// 获取实例的输出缓冲区引用（用于终端渲染）
    ///
    /// 返回 Arc<RwLock<OutputBuffer>> 的克隆，调用者可以直接读取缓冲区内容。
    pub fn get_buffer(&self, instance_id: &str) -> Result<Arc<RwLock<OutputBuffer>>, ConfluxError> {
        let processes = self.processes.read();
        let process = processes
            .get(instance_id)
            .ok_or_else(|| ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            })?;

        Ok(Arc::clone(&process.buffer))
    }

    /// C2-T1 exit 检测 · 前端轮询：进程是否已经退出？
    ///
    /// 双重检测策略（belt-and-suspenders）：
    ///   1. Fast path: reader_done AtomicBool（读取线程 break 后设置）
    ///   2. Slow path: child.try_wait()（非阻塞 waitpid / WaitForSingleObject）
    ///
    /// Windows ConPTY 的 master reader 在 child exit 后**不一定返回 EOF**
    /// （阻塞在 ReadFile 上），所以 reader_done 可能永远是 false。
    /// `try_wait` 是最终的可靠检测手段——它直接问 OS "这个 pid 还活着吗？"
    ///
    /// 调用频率：前端每 ~2s 轮询一次，只在 subscribeToPty=true 时启用。
    ///
    /// 注意：需要 write lock 因为 try_wait(&mut self)。轮询间隔 2s
    /// 使得 contention 可以接受。
    pub fn is_process_exited(&self, instance_id: &str) -> Result<bool, ConfluxError> {
        // Fast path: reader already signaled done (no lock upgrade needed)
        {
            let processes = self.processes.read();
            let process =
                processes
                    .get(instance_id)
                    .ok_or_else(|| ConfluxError::InstanceNotFound {
                        instance_id: instance_id.to_string(),
                    })?;
            if process.reader_done.load(Ordering::Acquire) {
                return Ok(true);
            }
        }

        // Slow path: ask the OS directly via try_wait (needs write lock)
        let mut processes = self.processes.write();
        let process =
            processes
                .get_mut(instance_id)
                .ok_or_else(|| ConfluxError::InstanceNotFound {
                    instance_id: instance_id.to_string(),
                })?;

        match process.child.try_wait() {
            Ok(Some(_exit_status)) => {
                // Process has exited. Set reader_done so subsequent polls
                // take the fast path. The reader thread may still be stuck
                // in ConPTY's ReadFile — it'll eventually unblock when we
                // kill/drop the PtyProcess during respawn or close.
                let ended_ms = now_millis();
                process.reader_done.store(true, Ordering::Release);
                process.ended_at.store(ended_ms, Ordering::Release);
                process.last_activity_at.store(ended_ms, Ordering::Release);
                log::info!(
                    "is_process_exited: child exited (try_wait), instance_id={}",
                    instance_id
                );
                Ok(true)
            }
            Ok(None) => Ok(false), // still running
            Err(e) => {
                log::warn!(
                    "is_process_exited: try_wait error (treating as alive): {}",
                    e
                );
                Ok(false)
            }
        }
    }
}

// ===== 特征测试（characterization）— mux cutover §3.5 第 1 步 =====
//
// 在把 PtyManager 迁移进 conmux::PaneHost **之前**，先用真实 cmd.exe 锁住现有
// spawn/kill/respawn/inject/resize/rename/status/buffer/state 的可观察行为，
// 迁移后这些测试（接口形态可调，语义不变）继续绿即视为无回归（cutover gate）。
//
// 安全前提（已核实）：本 crate 用 portable-pty 0.8.1，CreatePseudoConsole 仅设
// RESIZE_QUIRK | WIN32_INPUT_MODE、**无 INHERIT_CURSOR** → 不触发 DSR `ESC[6n`
// 启动阻塞，故 shell 模式 spawn cmd.exe 不会挂（迁到 0.9 后需 DSR 应答，见 D2/spike）。
//
// 纪律：每个 spawn 真实进程的测试结束必 kill，避免泄漏 cmd.exe。仅 Windows 有意义。
#[cfg(test)]
#[cfg(windows)]
mod characterization_tests {
    use super::*;

    /// shell 模式 spawn cmd.exe（adapter=None / dispatch=None → 只写 OutputBuffer，
    /// 无 parser/事件派发），返回 instance_id。
    fn spawn_shell(mgr: &PtyManager) -> String {
        mgr.spawn(
            "cmd.exe",
            &[],
            ".",
            "shell",
            "Shell",
            None,
            None,
            AgentMode::Full,
            false,
            None,
        )
        .expect("spawn cmd.exe 应成功")
    }

    #[test]
    fn spawn_registers_instance_with_expected_fields() {
        let mgr = PtyManager::new();
        let id = spawn_shell(&mgr);

        let list = mgr.list_instances();
        assert_eq!(list.len(), 1, "spawn 后应有 1 个实例");
        let info = &list[0];
        assert_eq!(info.instance_id.0, id);
        assert_eq!(info.adapter_id.0, "shell");
        assert_eq!(info.adapter_name, "Shell");
        assert_eq!(info.display_name, None);
        assert_eq!(info.status, AgentStatus::Idle, "初始状态为 Idle");
        assert!(!info.hidden);
        assert_eq!(info.mode, AgentMode::Full);
        assert_eq!(info.ended_at, None, "运行中 ended_at 为 None");

        // get_instance_state 与 list 一致
        let st = mgr.get_instance_state(&id).expect("state 应存在");
        assert_eq!(st.adapter_id.0, "shell");
        assert_eq!(st.status, AgentStatus::Idle);

        mgr.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn spawn_with_id_uses_provided_id() {
        let mgr = PtyManager::new();
        let id = mgr
            .spawn_with_id(
                "char-fixed-id".to_string(),
                "cmd.exe",
                &[],
                ".",
                "shell",
                "Shell",
                None,
                None,
                AgentMode::Full,
                false,
                None,
            )
            .expect("spawn_with_id 应成功");
        assert_eq!(id, "char-fixed-id");
        assert!(mgr
            .list_instances()
            .iter()
            .any(|i| i.instance_id.0 == "char-fixed-id"));
        mgr.kill("char-fixed-id").expect("kill 应成功");
    }

    #[test]
    fn operations_on_unknown_instance_return_not_found() {
        let mgr = PtyManager::new();
        let unknown = "does-not-exist";
        assert!(matches!(
            mgr.inject_stdin(unknown, "x"),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            mgr.resize(unknown, 80, 24),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            mgr.rename_instance(unknown, Some("a".into())),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            mgr.update_status(unknown, AgentStatus::Coding),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            mgr.get_instance_state(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            mgr.get_buffer(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            mgr.get_agent_tree(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            mgr.kill(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
        assert!(matches!(
            mgr.is_process_exited(unknown),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
    }

    #[test]
    fn inject_resize_ok_on_running_instance() {
        let mgr = PtyManager::new();
        let id = spawn_shell(&mgr);
        assert!(mgr.inject_stdin(&id, "echo hi\r\n").is_ok());
        assert!(mgr.resize(&id, 100, 40).is_ok());
        mgr.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn rename_updates_display_name() {
        let mgr = PtyManager::new();
        let id = spawn_shell(&mgr);
        mgr.rename_instance(&id, Some("my-alias".into())).unwrap();
        assert_eq!(
            mgr.get_instance_state(&id).unwrap().display_name,
            Some("my-alias".into())
        );
        mgr.rename_instance(&id, None).unwrap();
        assert_eq!(mgr.get_instance_state(&id).unwrap().display_name, None);
        mgr.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn update_status_is_reflected_in_state() {
        let mgr = PtyManager::new();
        let id = spawn_shell(&mgr);
        mgr.update_status(&id, AgentStatus::Coding).unwrap();
        assert_eq!(mgr.get_instance_state(&id).unwrap().status, AgentStatus::Coding);
        mgr.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn shell_mode_agent_tree_is_single_root_node() {
        let mgr = PtyManager::new();
        let id = spawn_shell(&mgr);
        let tree = mgr.get_agent_tree(&id).unwrap();
        assert_eq!(tree.root.id, id);
        assert_eq!(tree.root.name, "Shell");
        assert!(tree.children.is_empty(), "shell 模式无 sub-agent");
        mgr.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn kill_removes_instance_from_registry() {
        let mgr = PtyManager::new();
        let id = spawn_shell(&mgr);
        assert_eq!(mgr.list_instances().len(), 1);
        mgr.kill(&id).expect("kill 应成功");
        assert_eq!(mgr.list_instances().len(), 0, "kill 后实例应移除");
        assert!(matches!(
            mgr.get_instance_state(&id),
            Err(ConfluxError::InstanceNotFound { .. })
        ));
    }

    #[test]
    fn respawn_reuses_same_id() {
        let mgr = PtyManager::new();
        let id = spawn_shell(&mgr);
        mgr.respawn(
            &id, "cmd.exe", &[], ".", "shell", "Shell", None, None, AgentMode::Full, false, None,
        )
        .expect("respawn 应成功");
        let list = mgr.list_instances();
        assert_eq!(list.len(), 1, "respawn 复用 id，不新增实例");
        assert_eq!(list[0].instance_id.0, id);
        mgr.kill(&id).expect("kill 应成功");
    }

    #[test]
    fn reader_thread_captures_output_into_buffer() {
        // 锁住核心行为：读取线程把 PTY 输出写进 OutputBuffer。
        let mgr = PtyManager::new();
        let id = spawn_shell(&mgr);
        // cmd.exe 交互态会回显输入；注入一条 echo 并给读取线程时间落盘。
        mgr.inject_stdin(&id, "echo CHARTEST_MARKER\r\n").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2500));
        let buf = mgr.get_buffer(&id).expect("buffer 应存在");
        let bytes = buf.read().read_all();
        let text = String::from_utf8_lossy(&bytes);
        assert!(
            text.contains("CHARTEST_MARKER"),
            "读取线程应把回显写进 buffer，实际:\n{text}"
        );
        mgr.kill(&id).expect("kill 应成功");
    }
}
