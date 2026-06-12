// ===== MuxNotify → ConfluxEvent 事件桥接（cutover ③）=====
//
// conmux 不依赖 Tauri——读线程把 per-pane 事件经 PaneEventSink 推给本桥；桥在
// **conmux 读线程语境**里完成（与原 manager.rs 读线程内联逻辑同构，无新并发模型）：
//   PaneOutput → 刷活动时间 → base64 emit PtyOutput（前端 subscribeToPty 零改动）
//              → parser feed → 逐条 emit 结构化事件（AttentionQueue ingest 链不变）
//   PaneExited → meta 标记退出 → emit ProcessExited（exit_code 现可携精确码，D-2a）
//
// 与原读线程的已知差量（设计 §1 冻结）：signal 恒为 None——conmux pump 不区分
// EOF/管道断（原实现 reader Err 时发 "pipe_broken"）；前端 ExitOverlay 不依赖该字段。
//
// 纯逻辑（事件构造 + meta 更新）拆为 `output_events` / `exit_events` 以便不依赖
// AppHandle 做单测；sink 实现只负责逐条 emit。

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::sync::Arc;
use tauri::AppHandle;

use conmux::{MuxNotify, PaneEventSink};

use crate::core::event_emit::emit_conflux_event;
use crate::core::{ConfluxEvent, InstanceId};
use crate::pty::meta::InstanceMetaRegistry;

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// PaneOutput 处理：刷活动时间 + 构造待 emit 事件列表（PtyOutput 在前，结构化事件随后）。
/// `seq` = conmux per-pane 单调序号（V1-core +seq：前端连续性对账 / V2 重放）。
pub(crate) fn output_events(
    meta: &InstanceMetaRegistry,
    instance_id: &str,
    data: &[u8],
    seq: u64,
    now_ms: i64,
) -> Vec<ConfluxEvent> {
    meta.touch(instance_id, now_ms);

    let mut events = vec![ConfluxEvent::PtyOutput {
        instance_id: InstanceId(instance_id.to_string()),
        data: BASE64.encode(data),
        seq: Some(seq),
        timestamp: now_ms,
    }];

    // 结构化事件解析（仅当实例注册了 parser——shell 模式跳过，与原实现一致）。
    if let Some(parser) = meta.parser(instance_id) {
        let parsed = {
            let mut guard = parser.lock();
            guard.feed(data)
        }; // 释放 parser 锁再扩入结果（emit 不持锁）
        events.extend(parsed);
    }

    events
}

/// PaneExited 处理：meta 标记退出 + 构造 ProcessExited 事件。
pub(crate) fn exit_events(
    meta: &InstanceMetaRegistry,
    instance_id: &str,
    exit_code: Option<i32>,
    now_ms: i64,
) -> Vec<ConfluxEvent> {
    meta.mark_exited(instance_id, now_ms);
    let adapter_id = meta
        .get(instance_id)
        .map(|m| m.adapter_id)
        .unwrap_or_default();
    vec![ConfluxEvent::ProcessExited {
        instance_id: InstanceId(instance_id.to_string()),
        adapter_id,
        exit_code,
        signal: None,
        timestamp: now_ms,
    }]
}

/// PaneEventSink 实现——PaneHost 读线程经此把机制事件转入 conflux 事件总线。
pub struct MuxEventBridge {
    app: AppHandle,
    meta: Arc<InstanceMetaRegistry>,
}

impl MuxEventBridge {
    pub fn new(app: AppHandle, meta: Arc<InstanceMetaRegistry>) -> Self {
        Self { app, meta }
    }
}

impl PaneEventSink for MuxEventBridge {
    fn on_notify(&self, notify: MuxNotify) {
        let now_ms = now_millis();
        let events = match notify {
            MuxNotify::PaneOutput { pane_id, data, seq } => {
                output_events(&self.meta, &pane_id.0, &data, seq, now_ms)
            }
            MuxNotify::PaneExited { pane_id, exit_code } => {
                exit_events(&self.meta, &pane_id.0, exit_code, now_ms)
            }
            // MuxNotify 为 #[non_exhaustive]：conmux 新增的事件变体在桥接层显式忽略，
            // 接入与否是策略决策（新变体随 conmux minor 发布说明评估）。
            _ => Vec::new(),
        };
        for event in &events {
            emit_conflux_event(&self.app, event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AgentMode, AgentStatus};
    use crate::pty::meta::InstanceMeta;

    fn registry_with(id: &str) -> InstanceMetaRegistry {
        let reg = InstanceMetaRegistry::new();
        reg.register(
            id,
            InstanceMeta {
                adapter_id: "claude-code".into(),
                adapter_name: "Claude Code".into(),
                display_name: None,
                status: AgentStatus::Idle,
                mode: AgentMode::Full,
                hidden: false,
                last_activity_at: 0,
                ended_at: None,
                exited: false,
                parser: None,
            },
        );
        reg
    }

    #[test]
    fn output_events_emit_base64_pty_output_and_touch_meta() {
        let reg = registry_with("i1");
        let events = output_events(&reg, "i1", b"hello \x1b[31mred\x1b[0m", 7, 5_000);
        assert_eq!(events.len(), 1, "无 parser 实例只发 PtyOutput");
        match &events[0] {
            ConfluxEvent::PtyOutput {
                instance_id,
                data,
                seq,
                timestamp,
            } => {
                assert_eq!(instance_id.0, "i1");
                assert_eq!(*timestamp, 5_000);
                assert_eq!(*seq, Some(7), "conmux per-pane seq 透传（V1-core +seq）");
                let decoded = BASE64.decode(data.as_bytes()).unwrap();
                assert_eq!(decoded, b"hello \x1b[31mred\x1b[0m", "原始字节（含 ANSI）无损");
            }
            other => panic!("应为 PtyOutput，实际 {other:?}"),
        }
        assert_eq!(reg.get("i1").unwrap().last_activity_at, 5_000);
    }

    /// V1-core seq 连续性：连续 PaneOutput 经桥后 seq 原样保序透传（无损，C6 前提）。
    #[test]
    fn output_events_preserve_seq_continuity() {
        let reg = registry_with("i1");
        let mut seqs = Vec::new();
        for s in 1..=5u64 {
            let events = output_events(&reg, "i1", b"x", s, 1_000 + s as i64);
            if let ConfluxEvent::PtyOutput { seq, .. } = &events[0] {
                seqs.push(seq.unwrap());
            }
        }
        assert_eq!(seqs, vec![1, 2, 3, 4, 5], "桥不丢帧不乱序（C6 无损约束）");
    }

    #[test]
    fn exit_events_mark_meta_and_carry_exit_code() {
        let reg = registry_with("i1");
        let events = exit_events(&reg, "i1", Some(5), 9_000);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::ProcessExited {
                instance_id,
                adapter_id,
                exit_code,
                signal,
                timestamp,
            } => {
                assert_eq!(instance_id.0, "i1");
                assert_eq!(adapter_id, "claude-code");
                assert_eq!(*exit_code, Some(5), "D-2a：精确退出码经事件透出");
                assert_eq!(*signal, None);
                assert_eq!(*timestamp, 9_000);
            }
            other => panic!("应为 ProcessExited，实际 {other:?}"),
        }
        let m = reg.get("i1").unwrap();
        assert!(m.exited);
        assert_eq!(m.ended_at, Some(9_000));
    }

    #[test]
    fn events_for_unknown_instance_still_emit_without_panic() {
        // 退出竞态：meta 已被 destroy 移除而读线程仍在 flush——事件仍发（前端按 id 丢弃），不 panic。
        let reg = InstanceMetaRegistry::new();
        assert_eq!(output_events(&reg, "ghost", b"x", 1, 1).len(), 1);
        assert_eq!(exit_events(&reg, "ghost", None, 1).len(), 1);
    }
}
