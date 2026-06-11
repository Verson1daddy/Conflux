// ===== 注意力队列 sweeper 线程（V1-core：超时 + defer 提醒闭环）=====
//
// 周期驱动 `AttentionQueue::sweep`（纯逻辑在 attention.rs，可独立单测；本模块只做
// 线程/锁/emit 的 IO 接线）：
//   - 超时：活跃项超 timeout_seconds 未处置 → Expired（System/Expire 审计）。
//     纯控制面记账（用户裁决）：不向 agent 注入任何决定。
//   - 提醒：deferred 项到 remind_at → 复活回 active（System/Remind 审计）→
//     重新出现在灵动岛/Sidebar。
//
// 锁序与 event_emit::ingest_into_attention_queue 一致：attention_queue(write) → db。
// 有变更才 emit attention_updated（释放锁后）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::core::event_emit::emit_attention_updated;

/// sweep 周期。超时/提醒均为秒-分钟级语义，1s 粒度足够。
const SWEEP_INTERVAL: Duration = Duration::from_secs(1);

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 启动 sweeper 后台线程。`stop` 置位即退出（app 退出路径设；进程结束线程随灭）。
pub fn spawn_attention_sweeper(app: AppHandle, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        log::debug!("attention sweeper 启动（interval={SWEEP_INTERVAL:?}）");
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(SWEEP_INTERVAL);
            let Some(state) = app.try_state::<crate::AppState>() else {
                continue;
            };
            let report = {
                let mut queue = state.attention_queue.write();
                let conn = state.db.lock();
                queue.sweep(&conn, now_millis())
            };
            if report.changed() {
                log::debug!(
                    "attention sweep：expired={}, reminded={}",
                    report.expired,
                    report.reminded
                );
                emit_attention_updated(&app);
            }
        }
        log::debug!("attention sweeper 退出");
    });
}
