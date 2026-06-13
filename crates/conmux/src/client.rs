//! conmux 瘦客户端（M2a，仅 Windows）：连接（自动拉起）+ 握手 + 请求-应答。
//!
//! CLI / GUI 壳 / 第三方前端共用。**自动拉起**（D-2，tmux 心智）：连接管道失败（无 daemon）
//! → detached spawn `conmux daemon` → 有限退避重试（总预算 ≤3s）。单实例由 daemon 侧
//! `FILE_FLAG_FIRST_PIPE_INSTANCE` 保证——竞态下多个 auto-spawn 只有一个 daemon 存活，
//! 其余 bind 失败退出，客户端连上存活者。
//!
//! **客户端反冒充（红队 M-4，部分）**：M2a 先打通连接 + 取服务端进程身份的钩子位
//! （`PipeStream` 侧由 daemon 取客户端身份）；签名校验主路径（`GetNamedPipeServerProcessId`
//! → Authenticode 比对）登记为 M2c 加固项（设计 D-3 I-2 客户端侧），此处先记 TODO 不放行降级。

use std::iter::once;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, DETACHED_PROCESS,
    PROCESS_INFORMATION, STARTUPINFOW,
};

use crate::pipe::{try_connect, ConnectOutcome, PipeStream};
use crate::protocol::{MuxOp, MuxPayload, MuxReply, MuxRequest, WireFrame, PROTOCOL_VERSION};
use crate::wire::{read_frame, write_frame, WireError};
use crate::ConmuxError;

/// 自动拉起后等待 daemon 就绪的总预算。
const SPAWN_READY_BUDGET: Duration = Duration::from_secs(3);

/// 一个已握手的客户端连接。
pub struct Client {
    stream: PipeStream,
    next_cid: u64,
}

impl Client {
    /// 连接当前用户 daemon；无 daemon ⇒ 自动拉起后重试（CLI 默认入口）。
    pub fn connect_or_spawn() -> Result<Self, ConmuxError> {
        let name = crate::pipe::default_pipe_name()?;
        Self::connect_named(&name, true)
    }

    /// 连接指定管道名，**不自动拉起**（测试 / 嵌入者已自管 daemon 生命周期时用）。
    pub fn connect(name: &str) -> Result<Self, ConmuxError> {
        Self::connect_named(name, false)
    }

    fn connect_named(name: &str, allow_spawn: bool) -> Result<Self, ConmuxError> {
        match try_connect(name, 1000)? {
            ConnectOutcome::Connected(s) => return Self::handshake(s),
            ConnectOutcome::NoDaemon => {
                if !allow_spawn {
                    return Err(ConmuxError::PtyError {
                        message: format!("daemon 未运行（管道 {name} 不存在），且未启用自动拉起"),
                    });
                }
            }
        }
        // 自动拉起：detached spawn 当前可执行文件的 `daemon` 子命令。
        spawn_daemon_detached()?;
        let deadline = Instant::now() + SPAWN_READY_BUDGET;
        loop {
            std::thread::sleep(Duration::from_millis(100));
            match try_connect(name, 500)? {
                ConnectOutcome::Connected(s) => return Self::handshake(s),
                ConnectOutcome::NoDaemon => {}
            }
            if Instant::now() >= deadline {
                return Err(ConmuxError::PtyError {
                    message: "自动拉起 daemon 后等待就绪超时（3s）".into(),
                });
            }
        }
    }

    /// D-4 握手：发 Hello → 收 HelloAck（版本严格相等）。
    fn handshake(mut stream: PipeStream) -> Result<Self, ConmuxError> {
        let hello = WireFrame::Hello {
            protocol_version: PROTOCOL_VERSION,
            client_kind: "conmux-cli".into(),
        };
        write_frame(&mut stream, &hello).map_err(wire_to_conmux)?;
        match read_frame(&mut stream).map_err(wire_to_conmux)? {
            WireFrame::HelloAck {
                protocol_version, ..
            } => {
                if protocol_version != PROTOCOL_VERSION {
                    return Err(ConmuxError::Unsupported {
                        message: format!(
                            "协议版本不匹配：客户端 {PROTOCOL_VERSION} vs daemon {protocol_version}"
                        ),
                    });
                }
                Ok(Self {
                    stream,
                    next_cid: 1,
                })
            }
            other => Err(ConmuxError::PtyError {
                message: format!("握手应答非 HelloAck：{other:?}"),
            }),
        }
    }

    /// 单次请求-应答。M2a 无订阅，故收到 `Notify` 一律忽略（M2b attach 时改为按 D-6 缓冲拼接）。
    pub fn request(&mut self, op: MuxOp) -> Result<MuxPayload, ConmuxError> {
        let cid = self.next_cid;
        self.next_cid = self.next_cid.wrapping_add(1);
        let req = WireFrame::Request(MuxRequest {
            correlation_id: cid,
            op,
        });
        write_frame(&mut self.stream, &req).map_err(wire_to_conmux)?;
        loop {
            match read_frame(&mut self.stream).map_err(wire_to_conmux)? {
                WireFrame::Reply(reply) => {
                    if reply.correlation_id() != cid {
                        continue; // 非本请求应答（M2a 单连接顺序往返，不应发生）
                    }
                    return match reply {
                        MuxReply::Ok { payload, .. } => Ok(payload),
                        MuxReply::Err { error, .. } => Err(error),
                    };
                }
                WireFrame::Notify(_) => continue, // M2a 忽略异步事件
                other => {
                    return Err(ConmuxError::PtyError {
                        message: format!("非预期帧方向（客户端只应收 Reply/Notify）：{other:?}"),
                    })
                }
            }
        }
    }
}

/// detached spawn 当前可执行文件的 `daemon` 子命令。
///
/// **必须 `bInheritHandles=FALSE`**（不用 std `Command`）：std Command 在 Windows 上以
/// `bInheritHandles=TRUE` 启动子进程，会把父进程**全部可继承句柄**复制进 daemon——
/// 包括调用方 stdout 若被重定向为管道（如 `$x = & conmux new` 捕获），daemon 持其副本
/// 会让父读端永不见 EOF（实测挂死）。CreateProcessW + 不继承句柄根除此泄漏；daemon
/// 自己经 stdio = 控制台/无（DETACHED_PROCESS|CREATE_NO_WINDOW），不依赖父句柄。
fn spawn_daemon_detached() -> Result<(), ConmuxError> {
    use std::os::windows::ffi::OsStrExt;
    let exe = std::env::current_exe().map_err(|e| ConmuxError::PtyError {
        message: format!("取当前可执行文件路径失败: {e}"),
    })?;
    let exe_wide: Vec<u16> = exe.as_os_str().encode_wide().chain(once(0)).collect();
    // 命令行（CreateProcessW 可改写，故 mutable）：`"<exe>" daemon`。
    let mut cmdline: Vec<u16> = format!("\"{}\" daemon", exe.display())
        .encode_utf16()
        .chain(once(0))
        .collect();

    let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
    si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    // SAFETY: exe_wide/cmdline 以 null 结尾；si/pi 已零初始化且 cb 正确；
    // bInheritHandles=FALSE（0）——daemon 不继承父任何句柄（关键）。
    let ok = unsafe {
        CreateProcessW(
            exe_wide.as_ptr(),
            cmdline.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0, // bInheritHandles = FALSE
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
            std::ptr::null(),
            std::ptr::null(),
            &si,
            &mut pi,
        )
    };
    if ok == 0 {
        let err = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        return Err(ConmuxError::PtyError {
            message: format!("自动拉起 conmux daemon 失败（CreateProcessW GetLastError={err}）"),
        });
    }
    // 不等待 daemon；立即关闭进程/线程句柄（daemon 经命名管道独立运行）。
    unsafe {
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
    Ok(())
}

fn wire_to_conmux(e: WireError) -> ConmuxError {
    match e {
        WireError::Json(je) => ConmuxError::SerializationError {
            message: je.to_string(),
        },
        other => ConmuxError::PtyError {
            message: other.to_string(),
        },
    }
}
