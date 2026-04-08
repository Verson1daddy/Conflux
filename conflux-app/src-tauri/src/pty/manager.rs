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
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize, PtySystem, SlavePty};

use crate::core::{
    AdapterId, AgentInstanceInfo, AgentStateDetail, AgentStatus, ConfluxError, InstanceId,
};
use crate::pty::buffer::{OutputBuffer, DEFAULT_BUFFER_CAPACITY};

/// 默认 PTY 终端尺寸：120 列 x 30 行
const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;

/// 输出读取线程的缓冲区大小（每次 read 调用的最大字节数）
const READ_CHUNK_SIZE: usize = 8192;

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
    /// stdin writer（用于 inject_stdin）
    writer: Box<dyn IoWrite + Send>,
    /// 输出缓冲区（与读取线程共享）
    buffer: Arc<RwLock<OutputBuffer>>,
    /// 创建时间（Unix 时间戳 ms）
    created_at: i64,
    /// 适配器 ID
    adapter_id: String,
    /// 适配器名称
    adapter_name: String,
    /// 工作目录
    working_dir: String,
    /// 当前 Agent 状态
    status: AgentStatus,
    /// PTY 尺寸
    pty_size: PtySize,
    /// master pty handle（用于 resize 操作）
    master_pty: Box<dyn portable_pty::MasterPty + Send>,
}

/// 获取当前时间戳（Unix 毫秒）
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
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
    pub fn spawn(
        &self,
        command: &str,
        args: &[String],
        working_dir: &str,
        adapter_id: &str,
        adapter_name: &str,
    ) -> Result<String, ConfluxError> {
        let instance_id = uuid::Uuid::new_v4().to_string();
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

        // 3. 构建命令
        let mut cmd = CommandBuilder::new(command);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.cwd(working_dir);

        // 4. 在 slave 上执行命令
        let child = pair.slave.spawn_command(cmd).map_err(|e| {
            log::error!("PTY spawn_command 失败: command={}, error={}", command, e);
            ConfluxError::PtyError {
                message: format!("spawn_command 失败 (command={}): {}", command, e),
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

        let writer = pair.master.try_clone_writer().map_err(|e| {
            log::error!("PTY try_clone_writer 失败: {}", e);
            ConfluxError::PtyError {
                message: format!("try_clone_writer 失败: {}", e),
            }
        })?;

        // 6. 创建输出缓冲区
        let buffer = Arc::new(RwLock::new(OutputBuffer::new(DEFAULT_BUFFER_CAPACITY)));
        let buffer_clone = Arc::clone(&buffer);
        let thread_instance_id = instance_id.clone();

        // 7. 启动后台线程持续读取 PTY 输出
        std::thread::spawn(move || {
            log::debug!(
                "PTY 输出读取线程启动: instance_id={}",
                thread_instance_id
            );
            let mut chunk = vec![0u8; READ_CHUNK_SIZE];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => {
                        // 进程已退出，read 返回 0 字节
                        log::debug!(
                            "PTY 输出读取线程结束（进程退出）: instance_id={}",
                            thread_instance_id
                        );
                        break;
                    }
                    Ok(n) => {
                        let mut buf = buffer_clone.write();
                        buf.write(&chunk[..n]);
                    }
                    Err(e) => {
                        // 读取错误（进程被终止或管道断开）
                        log::debug!(
                            "PTY 输出读取线程结束（读取错误）: instance_id={}, error={}",
                            thread_instance_id,
                            e
                        );
                        break;
                    }
                }
            }
        });

        // 8. 构建 PtyProcess 并存入映射表
        let process = PtyProcess {
            child,
            writer,
            buffer,
            created_at: now_millis(),
            adapter_id: adapter_id.to_string(),
            adapter_name: adapter_name.to_string(),
            working_dir: working_dir.to_string(),
            status: AgentStatus::Idle,
            pty_size: default_size,
            master_pty: pair.master,
        };

        {
            let mut processes = self.processes.write();
            processes.insert(instance_id.clone(), process);
        }

        log::debug!("PTY spawn 完成: instance_id={}", instance_id);
        Ok(instance_id)
    }

    /// 向指定实例的 stdin 注入内容
    ///
    /// 将 input 字符串以 UTF-8 字节写入 PTY 进程的 stdin。
    /// 调用者负责在 input 末尾添加换行符（如果需要）。
    pub fn inject_stdin(&self, instance_id: &str, input: &str) -> Result<(), ConfluxError> {
        let mut processes = self.processes.write();
        let process = processes.get_mut(instance_id).ok_or_else(|| {
            ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            }
        })?;

        process
            .writer
            .write_all(input.as_bytes())
            .map_err(|e| ConfluxError::PtyError {
                message: format!("stdin 写入失败 (instance_id={}): {}", instance_id, e),
            })?;

        process.writer.flush().map_err(|e| ConfluxError::PtyError {
            message: format!("stdin flush 失败 (instance_id={}): {}", instance_id, e),
        })?;

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
        let process = processes.get_mut(instance_id).ok_or_else(|| {
            ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            }
        })?;

        let new_size = PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        };

        process
            .master_pty
            .resize(new_size)
            .map_err(|e| ConfluxError::PtyError {
                message: format!(
                    "resize 失败 (instance_id={}, {}x{}): {}",
                    instance_id, cols, rows, e
                ),
            })?;

        process.pty_size = new_size;

        log::debug!(
            "resize 完成: instance_id={}, cols={}, rows={}",
            instance_id,
            cols,
            rows
        );
        Ok(())
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
    /// is_primary_framework 字段始终为 false（由上层 AppState 管理）。
    pub fn list_instances(&self) -> Vec<AgentInstanceInfo> {
        let processes = self.processes.read();
        processes
            .iter()
            .map(|(id, proc)| AgentInstanceInfo {
                instance_id: InstanceId(id.clone()),
                adapter_id: AdapterId(proc.adapter_id.clone()),
                adapter_name: proc.adapter_name.clone(),
                status: proc.status.clone(),
                working_dir: proc.working_dir.clone(),
                is_primary_framework: false, // 由 AppState 层管理
                created_at: proc.created_at,
            })
            .collect()
    }

    /// 获取指定实例的状态详情
    ///
    /// is_primary_framework 字段始终为 false（由上层 AppState 管理）。
    pub fn get_instance_state(
        &self,
        instance_id: &str,
    ) -> Result<AgentStateDetail, ConfluxError> {
        let processes = self.processes.read();
        let process = processes.get(instance_id).ok_or_else(|| {
            ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            }
        })?;

        Ok(AgentStateDetail {
            instance_id: InstanceId(instance_id.to_string()),
            adapter_id: AdapterId(process.adapter_id.clone()),
            adapter_name: process.adapter_name.clone(),
            status: process.status.clone(),
            working_dir: process.working_dir.clone(),
            is_primary_framework: false, // 由 AppState 层管理
            created_at: process.created_at,
            last_activity_at: now_millis(), // 查询时刷新
        })
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
        let process = processes.get_mut(instance_id).ok_or_else(|| {
            ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            }
        })?;

        log::debug!(
            "状态更新: instance_id={}, {:?} -> {:?}",
            instance_id,
            process.status,
            status
        );
        process.status = status;
        Ok(())
    }

    /// 获取实例的输出缓冲区引用（用于终端渲染）
    ///
    /// 返回 Arc<RwLock<OutputBuffer>> 的克隆，调用者可以直接读取缓冲区内容。
    pub fn get_buffer(
        &self,
        instance_id: &str,
    ) -> Result<Arc<RwLock<OutputBuffer>>, ConfluxError> {
        let processes = self.processes.read();
        let process = processes.get(instance_id).ok_or_else(|| {
            ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            }
        })?;

        Ok(Arc::clone(&process.buffer))
    }
}
