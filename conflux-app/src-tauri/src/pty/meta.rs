// ===== 实例策略元数据表（cutover ③）=====
//
// conmux::PaneHost 只携带机制态（PaneState：lifecycle/pid/working_dir/size/scrollback）；
// AgentStatus（语义状态）/ mode / hidden / adapter_name / 活动时间戳 / parser 句柄等
// **策略态**归 conflux，收敛于本表。`PaneRuntime` 门面合并两侧出 AgentInstanceInfo；
// `MuxEventBridge`（读线程语境）经共享 Arc 更新活动/退出标记并取 parser。
//
// display_name 以本表为准——conmux PaneState.display_name 是 spawn 时快照，
// rename 只写本表（conmux 无 rename 概念，语义属策略层）。

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;

use crate::core::{AgentMode, AgentStatus};
use crate::pty::parser::PtyOutputParser;

/// 单实例策略元数据。
#[derive(Clone)]
pub struct InstanceMeta {
    pub adapter_id: String,
    pub adapter_name: String,
    pub display_name: Option<String>,
    pub status: AgentStatus,
    pub mode: AgentMode,
    pub hidden: bool,
    /// 最后活动时间（Unix ms）：输出 / 注入 / 状态变更 / rename 均刷新。
    pub last_activity_at: i64,
    /// 结束时间（Unix ms）；None = 仍在运行。
    pub ended_at: Option<i64>,
    /// 进程已退出标记（PaneExited 事件或 poll_exit 兜底置位）。
    pub exited: bool,
    /// 共享 parser（bridge feed / get_agent_tree 查询）；shell 等无 adapter 实例为 None。
    pub parser: Option<Arc<parking_lot::Mutex<PtyOutputParser>>>,
}

/// instance_id -> InstanceMeta。所有变更在写锁内完成；快照读出后即与表解耦。
#[derive(Default)]
pub struct InstanceMetaRegistry {
    inner: RwLock<HashMap<String, InstanceMeta>>,
}

impl InstanceMetaRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 注册（spawn 前调用，保证读线程第一块输出就能取到 parser）。
    pub fn register(&self, instance_id: &str, meta: InstanceMeta) {
        self.inner.write().insert(instance_id.to_string(), meta);
    }

    /// 移除（kill/destroy 或 spawn 失败回滚）。
    pub fn remove(&self, instance_id: &str) {
        self.inner.write().remove(instance_id);
    }

    pub fn contains(&self, instance_id: &str) -> bool {
        self.inner.read().contains_key(instance_id)
    }

    /// 快照单实例元数据。
    pub fn get(&self, instance_id: &str) -> Option<InstanceMeta> {
        self.inner.read().get(instance_id).cloned()
    }

    /// 取共享 parser 句柄（bridge 输出路径高频调用）。
    pub fn parser(&self, instance_id: &str) -> Option<Arc<parking_lot::Mutex<PtyOutputParser>>> {
        self.inner.read().get(instance_id).and_then(|m| m.parser.clone())
    }

    /// 刷新活动时间（输出/注入路径）。实例不存在时静默忽略（退出竞态无害）。
    pub fn touch(&self, instance_id: &str, now_ms: i64) {
        if let Some(m) = self.inner.write().get_mut(instance_id) {
            m.last_activity_at = now_ms;
        }
    }

    /// 标记进程退出（PaneExited 事件 / poll_exit 兜底）。幂等。
    pub fn mark_exited(&self, instance_id: &str, now_ms: i64) {
        if let Some(m) = self.inner.write().get_mut(instance_id) {
            if !m.exited {
                m.exited = true;
                m.ended_at = Some(now_ms);
            }
            m.last_activity_at = now_ms;
        }
    }

    /// 更新语义状态（原 manager.update_status）。
    pub fn set_status(&self, instance_id: &str, status: AgentStatus, now_ms: i64) -> bool {
        match self.inner.write().get_mut(instance_id) {
            Some(m) => {
                m.status = status;
                m.last_activity_at = now_ms;
                true
            }
            None => false,
        }
    }

    /// 更新别名（原 manager.rename_instance；display_name 权威在本表）。
    pub fn set_display_name(
        &self,
        instance_id: &str,
        display_name: Option<String>,
        now_ms: i64,
    ) -> bool {
        match self.inner.write().get_mut(instance_id) {
            Some(m) => {
                m.display_name = display_name;
                m.last_activity_at = now_ms;
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(adapter_id: &str) -> InstanceMeta {
        InstanceMeta {
            adapter_id: adapter_id.to_string(),
            adapter_name: "Claude Code".to_string(),
            display_name: None,
            status: AgentStatus::Idle,
            mode: AgentMode::Full,
            hidden: false,
            last_activity_at: 1_000,
            ended_at: None,
            exited: false,
            parser: None,
        }
    }

    #[test]
    fn register_get_remove_roundtrip() {
        let reg = InstanceMetaRegistry::new();
        reg.register("i1", meta("claude-code"));
        assert!(reg.contains("i1"));
        assert_eq!(reg.get("i1").unwrap().adapter_id, "claude-code");
        reg.remove("i1");
        assert!(!reg.contains("i1"));
        assert!(reg.get("i1").is_none());
    }

    #[test]
    fn touch_updates_last_activity_and_ignores_missing() {
        let reg = InstanceMetaRegistry::new();
        reg.register("i1", meta("a"));
        reg.touch("i1", 2_000);
        assert_eq!(reg.get("i1").unwrap().last_activity_at, 2_000);
        reg.touch("ghost", 3_000); // 静默忽略
    }

    #[test]
    fn mark_exited_is_idempotent_and_keeps_first_ended_at() {
        let reg = InstanceMetaRegistry::new();
        reg.register("i1", meta("a"));
        reg.mark_exited("i1", 5_000);
        reg.mark_exited("i1", 9_000);
        let m = reg.get("i1").unwrap();
        assert!(m.exited);
        assert_eq!(m.ended_at, Some(5_000), "首个退出时间不被覆写");
        assert_eq!(m.last_activity_at, 9_000);
    }

    #[test]
    fn set_status_and_display_name_report_missing() {
        let reg = InstanceMetaRegistry::new();
        reg.register("i1", meta("a"));
        assert!(reg.set_status("i1", AgentStatus::Coding, 2_000));
        assert_eq!(reg.get("i1").unwrap().status, AgentStatus::Coding);
        assert!(reg.set_display_name("i1", Some("rev".into()), 2_100));
        assert_eq!(reg.get("i1").unwrap().display_name, Some("rev".into()));
        assert!(!reg.set_status("ghost", AgentStatus::Idle, 0));
        assert!(!reg.set_display_name("ghost", None, 0));
    }
}
