//! Hook 事件源运行时（A.2 修复 / mux V1-core）：把 Claude Code 的 PermissionRequest
//! hook 事件接进控制面注意力队列。
//!
//! 数据流（方案 A = 文件 IPC + PTY 注入，用户 2026-06-11 裁决）：
//! ```text
//! claude PermissionRequest hook ─► node relay ─append─► <instance>.ndjson
//!                                                              │ (watcher 轮询)
//!   ConfluxEvent::PermissionRequested ◄── parse_hook_ndjson ◄──┘
//!         │ emit_conflux_event
//!         └─► event_emit::ingest_into_attention_queue ─► AttentionQueue ─► 灵动岛
//! ```
//! approve 复用现有 `respond_to_permission`（PTY 注入 Y/N），本模块只负责"感知"。
//!
//! 机制实测见 `research/hook-spike-2026-06-11/HOOK_SPIKE_RESULT.md`。
//! 纯逻辑（解析/映射/settings 构建）在 `core/hook.rs`，本模块只做 IO（落盘 relay + 轮询 + emit）。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;

use crate::core::event_emit::emit_conflux_event;
use crate::core::hook::{parse_hook_ndjson, HOOK_RELAY_JS};
use crate::core::{ConfluxEvent, InstanceId};

/// watcher 轮询间隔。权限事件非高频，几百 ms 延迟可接受（不与 PTY 渲染争资源）。
const POLL_INTERVAL: Duration = Duration::from_millis(400);

/// hook relay 脚本文件名（落在 app data 的 hooks 子目录）。
const RELAY_FILENAME: &str = "hook-relay.js";

/// 每实例的 hook 文件路径集（settings + ndjson out）。
pub struct HookPaths {
    /// 注入给 claude `--settings` 的 per-instance 设置文件。
    pub settings_file: PathBuf,
    /// relay append 的 per-instance ndjson 输出文件。
    pub out_file: PathBuf,
}

/// 确保 hook 目录存在并落盘 relay 脚本（幂等，app 启动时调用一次）。
/// 返回 relay 脚本绝对路径。失败返回 Err（调用方降级为"无 hook 感知"，不阻塞启动）。
pub fn provision_relay(hook_dir: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(hook_dir)?;
    let relay_path = hook_dir.join(RELAY_FILENAME);
    // 总是覆写——保证 relay 内容随 app 版本更新（内容固定，幂等）。
    let mut f = std::fs::File::create(&relay_path)?;
    f.write_all(HOOK_RELAY_JS.as_bytes())?;
    Ok(relay_path)
}

/// 为某实例生成 hook 文件路径（不创建文件）。
pub fn instance_paths(hook_dir: &Path, instance_id: &str) -> HookPaths {
    HookPaths {
        settings_file: hook_dir.join(format!("{instance_id}.settings.json")),
        out_file: hook_dir.join(format!("{instance_id}.ndjson")),
    }
}

/// 写 per-instance settings 文件（内容 = `core::hook::build_claude_hook_settings_arg`）。
/// 同时清掉可能残留的旧 ndjson（复用 id 的极端情况）。
pub fn write_instance_settings(
    paths: &HookPaths,
    relay_path: &Path,
    settings_json: &str,
) -> std::io::Result<()> {
    let _ = relay_path; // 路径已嵌入 settings_json（由 build 函数构造），此处仅签名留痕
    let _ = std::fs::remove_file(&paths.out_file);
    let mut f = std::fs::File::create(&paths.settings_file)?;
    f.write_all(settings_json.as_bytes())?;
    Ok(())
}

/// 清理某实例的 hook 文件（destroy 时调用，best-effort）。
pub fn cleanup_instance(paths: &HookPaths) {
    let _ = std::fs::remove_file(&paths.settings_file);
    let _ = std::fs::remove_file(&paths.out_file);
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 启动一个后台 watcher 线程：轮询 `out_file`，把新增的 PermissionRequest 事件
/// 转成 `ConfluxEvent::PermissionRequested` 并 emit（自动经 ingest 进 AttentionQueue）。
///
/// - 按字节 offset 增量读取，只处理到最后一个 `\n` 为止，半行留到下次（防截断）。
/// - 仅对 `is_approval_signal()`（= PermissionRequest 且非 bypass）上浮；PreToolUse 行
///   一并落盘但**不上浮**（避免只读工具误报，见 HOOK_SPIKE_RESULT.md 关键语义发现）。
/// - `stop` 置位即退出（destroy 时设）。
pub fn spawn_hook_watcher(
    app: AppHandle,
    instance_id: String,
    out_file: PathBuf,
    stop: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut offset: u64 = 0;
        log::debug!("hook watcher 启动: instance_id={instance_id}, out={out_file:?}");
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(POLL_INTERVAL);
            // 文件可能尚未被 relay 创建（还没触发 hook）。
            let content = match std::fs::read(&out_file) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };
            let len = content.len() as u64;
            if len <= offset {
                continue; // 无新增（== 无变化；< 仅在文件被截断时，保守跳过）
            }
            let new_slice = &content[offset as usize..];
            // 只处理到最后一个换行，半行留到下次。
            let last_nl = match new_slice.iter().rposition(|&b| b == b'\n') {
                Some(p) => p,
                None => continue, // 还没有完整行
            };
            let complete = &new_slice[..=last_nl];
            offset += complete.len() as u64;

            let text = String::from_utf8_lossy(complete);
            for ev in parse_hook_ndjson(&text) {
                if !ev.is_approval_signal() {
                    continue; // PreToolUse 等不上浮
                }
                let mut req = ev.to_permission_request(&instance_id, now_millis());
                if req.id.is_empty() {
                    req.id = uuid::Uuid::new_v4().to_string();
                }
                let event = ConfluxEvent::PermissionRequested {
                    instance_id: InstanceId(instance_id.clone()),
                    request: req,
                    timestamp: now_millis(),
                };
                emit_conflux_event(&app, &event);
                log::debug!(
                    "hook watcher 上浮权限请求: instance_id={instance_id}, tool={}",
                    ev.tool_name
                );
            }
        }
        log::debug!("hook watcher 退出: instance_id={instance_id}");
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provision_relay_writes_node_script() {
        let dir = std::env::temp_dir().join(format!("conmux_relay_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let relay = provision_relay(&dir).expect("provision 应成功");
        assert!(relay.exists());
        let content = std::fs::read_to_string(&relay).unwrap();
        assert!(content.contains("appendFileSync"));
        assert!(content.contains("--out"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn instance_paths_are_per_id() {
        let dir = Path::new("/tmp/hooks");
        let p = instance_paths(dir, "inst-9");
        assert!(p.settings_file.ends_with("inst-9.settings.json"));
        assert!(p.out_file.ends_with("inst-9.ndjson"));
    }

    #[test]
    fn write_settings_clears_stale_out_and_writes_settings() {
        let dir = std::env::temp_dir().join(format!("conmux_settings_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let paths = instance_paths(&dir, "inst-x");
        // 预置残留 out 文件
        std::fs::write(&paths.out_file, b"stale\n").unwrap();
        write_instance_settings(&paths, Path::new("relay.js"), r#"{"hooks":{}}"#).unwrap();
        assert!(paths.settings_file.exists());
        assert!(!paths.out_file.exists(), "旧 out 文件应被清掉");
        assert_eq!(
            std::fs::read_to_string(&paths.settings_file).unwrap(),
            r#"{"hooks":{}}"#
        );
        cleanup_instance(&paths);
        assert!(!paths.settings_file.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
