// ===== 控制面后台 ticker 线程（V1-core）=====
//
// 单线程双职责（250ms tick）：
//   1. **每 tick**：D3 UserDirect 批审计时间窗 flush（`AuditHook::flush_due`，
//      会签条件 ≤500ms——250ms 粒度保证最坏 ~500ms 内落库）。
//   2. **每 4 tick（1s）**：`AttentionQueue::sweep`（纯逻辑在 attention.rs）：
//      - 超时：活跃项超 timeout_seconds → Expired（System/Expire 审计）。
//        纯控制面记账（用户裁决）：不向 agent 注入任何决定。
//      - 提醒：deferred 到 remind_at → 复活回 active（System/Remind 审计）。
//
// 锁序与 event_emit::ingest_into_attention_queue 一致：attention_queue(write) → db。
// 有变更才 emit attention_updated（释放锁后）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::core::event_emit::{emit_attention_expired, emit_attention_updated};

/// 基础 tick（D3 审计 flush 检查粒度）。
const TICK_INTERVAL: Duration = Duration::from_millis(250);
/// sweep 节拍：每 N 个 tick 跑一次（= 1s，超时/提醒为秒-分钟级语义足够）。
const SWEEP_EVERY_TICKS: u32 = 4;

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 启动后台 ticker 线程。`stop` 置位即退出（app 退出路径设，并随后 flush_all）。
pub fn spawn_background_ticker(app: AppHandle, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        log::debug!("控制面 ticker 启动（tick={TICK_INTERVAL:?}，sweep 每 {SWEEP_EVERY_TICKS} tick）");
        let mut tick: u32 = 0;
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(TICK_INTERVAL);
            tick = tick.wrapping_add(1);
            let Some(state) = app.try_state::<crate::AppState>() else {
                continue;
            };

            // 1) D3：UserDirect 批审计时间窗 flush（每 tick）。
            state.audit_hook.flush_due(now_millis());

            // 2) 注意力 sweep（每 SWEEP_EVERY_TICKS tick）。
            if tick % SWEEP_EVERY_TICKS == 0 {
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
                    // spec §4.1：过期项转前端通知（只读投影，不静默消失）。
                    emit_attention_expired(&app, &report.expired_items);
                }
            }
        }
        log::debug!("控制面 ticker 退出");
    });
}
