// ===== Conflux 编排操作 Tauri Commands =====
// 5 个 IPC 命令：讨论管理 + 主框架设置
//
// 讨论操作同时更新内存（DiscussionEngine）和数据库（persistence 层），
// 确保崩溃恢复时数据不丢失。
//
// 注意：AppState 需要 orchestrator 后续添加 `db` 和 `discussion_engine` 字段。
// 本模块假设这两个字段存在于 AppState 中（使用 parking_lot 一致性）：
//   pub db: parking_lot::Mutex<rusqlite::Connection>
//   pub discussion_engine: parking_lot::RwLock<DiscussionEngine>

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::core::event_emit::emit_conflux_event;
use crate::core::{
    AgentMode, ConfluxError, ConfluxEvent, DiscussionId, DiscussionMessage, DiscussionSession,
    DiscussionSummary, InstanceId, MessageSender,
};
use crate::persistence::query as db_query;
use crate::AppState;

/// 创建新的多 Agent 讨论
///
/// 同时在内存（DiscussionEngine）和数据库中创建讨论记录。
/// 包含一条系统开场消息。
///
/// # 参数
/// - `topic`: 讨论主题
/// - `participant_ids`: 参与者 Agent 实例 ID 列表
/// - `max_rounds`: 最大讨论轮次（默认 5）
///
/// # 返回
/// 新创建的 DiscussionSession
/// IPC 输入长度上限——topic（HIGH-01 修复）
const MAX_TOPIC_LENGTH: usize = 1_000;
/// IPC 输入长度上限——消息内容（HIGH-01 修复）
const MAX_CONTENT_LENGTH: usize = 50_000;

#[tauri::command]
pub async fn start_discussion(
    app: AppHandle,
    state: State<'_, AppState>,
    topic: String,
    participant_ids: Vec<InstanceId>,
    max_rounds: Option<u32>,
) -> Result<DiscussionSession, ConfluxError> {
    // HIGH-01 修复：输入长度验证
    if topic.len() > MAX_TOPIC_LENGTH {
        return Err(ConfluxError::OrchestrationError {
            message: format!("topic 长度 {} 超过上限 {}", topic.len(), MAX_TOPIC_LENGTH),
        });
    }
    let rounds = max_rounds.unwrap_or(5);

    // B3.1 Contract 2: For each participant, spawn a hidden sandbox instance
    //
    // P1-3 修复：spawn 开始后任一步失败（后续参与者查 map / spawn 失败、入库失败）
    // 必须回滚已 spawn 的 sandbox（kill + instance_adapter_map 清理），否则泄漏隐藏
    // PTY 进程。setup 闭包内任何 `?` 早返回都落入下方统一回滚分支。
    let mut sandbox_instance_ids: Vec<InstanceId> = Vec::new();

    let setup_result =
        (|| -> Result<(DiscussionSession, Option<DiscussionMessage>), ConfluxError> {
            for participant_id in &participant_ids {
                // Look up the adapter_id from the workspace instance
                let adapter_id = {
                    let map = state.instance_adapter_map.read();
                    map.get(&participant_id.0).cloned().ok_or_else(|| {
                        ConfluxError::InstanceNotFound {
                            instance_id: participant_id.0.clone(),
                        }
                    })?
                };

                // Get adapter config + trait object
                let (adapter_config, adapter_arc) = {
                    let registry = state.adapter_registry.read();
                    let config = registry.get_config(&adapter_id).cloned().ok_or_else(|| {
                        ConfluxError::AdapterNotFound {
                            adapter_id: adapter_id.clone(),
                        }
                    })?;
                    let adapter =
                        registry
                            .get(&adapter_id)
                            .ok_or_else(|| ConfluxError::AdapterNotFound {
                                adapter_id: adapter_id.clone(),
                            })?;
                    (config, adapter)
                };

                // Get the workspace instance's working_dir to reuse
                let work_dir = state
                    .pty_manager
                    .get_instance_state(&participant_id.0)
                    .map(|detail| detail.working_dir)
                    .unwrap_or_else(|_| ".".to_string());

                // Build sandbox args: default_args + sandbox_args
                let mut spawn_args = adapter_config.default_args.clone();
                spawn_args.extend(adapter_config.sandbox_args.clone());

                // Build event dispatcher
                let app_handle = app.clone();
                let dispatcher: crate::pty::manager::EventDispatcher =
                    Arc::new(move |event: &ConfluxEvent| {
                        emit_conflux_event(&app_handle, event);
                    });

                // Spawn hidden sandbox instance
                let sandbox_id_str = state.pty_manager.spawn(
                    &adapter_config.command,
                    &spawn_args,
                    &work_dir,
                    &adapter_id,
                    &adapter_config.name,
                    Some(adapter_arc),
                    Some(dispatcher),
                    AgentMode::Sandbox,
                    true, // hidden = true
                    None, // display_name: sandbox 实例不需要别名
                )?;

                let sandbox_id = InstanceId(sandbox_id_str);

                // Record instance_id -> adapter_id mapping
                {
                    let mut map = state.instance_adapter_map.write();
                    map.insert(sandbox_id.0.clone(), adapter_id.clone());
                }

                sandbox_instance_ids.push(sandbox_id);
            }

            // 1. 在内存中创建讨论（带 sandbox_instance_ids）
            let (session, system_msg) = {
                let mut engine = state.discussion_engine.write();
                let session =
                    engine.start(topic, participant_ids, sandbox_instance_ids.clone(), rounds);
                // 获取系统开场消息用于写入数据库
                let msgs = engine
                    .get_messages(&session.id.0)
                    .cloned()
                    .unwrap_or_default();
                let system_msg = msgs.into_iter().next();
                (session, system_msg)
            };

            // 2. 持久化到数据库；失败时同时移除刚建的内存 session
            //（防 ghost 讨论引用已被回滚的 sandbox）
            let persisted: Result<(), ConfluxError> = (|| {
                let db = state.db.lock();
                db_query::insert_discussion(&db, &session)?;

                // 同步写入系统开场消息
                if let Some(msg) = &system_msg {
                    db_query::insert_discussion_message(&db, msg)?;
                }
                Ok(())
            })();
            if let Err(e) = persisted {
                let mut engine = state.discussion_engine.write();
                let _ = engine.end(&session.id.0); // best-effort 移除内存侧
                return Err(e);
            }

            Ok((session, system_msg))
        })();

    let (session, _system_msg) = match setup_result {
        Ok(v) => v,
        Err(e) => {
            let killed = rollback_spawned_sandboxes(
                |id| state.pty_manager.kill(id),
                &state.instance_adapter_map,
                &sandbox_instance_ids,
            );
            log::warn!(
                "start_discussion 失败，已回滚 {}/{} 个 sandbox 实例: {:?}",
                killed,
                sandbox_instance_ids.len(),
                e
            );
            return Err(e);
        }
    };

    log::debug!(
        "讨论已创建: id={}, topic={}, sandbox_instances={}",
        session.id.0,
        session.topic,
        session.sandbox_instance_ids.len()
    );
    Ok(session)
}

/// 向指定讨论发送消息
///
/// 消息同时写入内存和数据库。轮次由 DiscussionEngine 自动管理。
///
/// # 参数
/// - `discussion_id`: 讨论 ID
/// - `content`: 消息内容
///
/// # 返回
/// 创建的 DiscussionMessage
#[tauri::command]
pub async fn send_discussion_message(
    app: AppHandle,
    state: State<'_, AppState>,
    discussion_id: DiscussionId,
    content: String,
) -> Result<DiscussionMessage, ConfluxError> {
    // HIGH-01 修复：输入长度验证
    if content.len() > MAX_CONTENT_LENGTH {
        return Err(ConfluxError::OrchestrationError {
            message: format!(
                "content 长度 {} 超过上限 {}",
                content.len(),
                MAX_CONTENT_LENGTH
            ),
        });
    }
    // 1. 在内存中发送消息
    let (msg, current_round) = {
        let mut engine = state.discussion_engine.write();
        let msg = engine.send_message(&discussion_id.0, content, MessageSender::User)?;
        let round = engine
            .get_session(&discussion_id.0)
            .map(|s| s.current_round)
            .unwrap_or(0);
        (msg, round)
    };

    // 2. 持久化到数据库
    {
        let db = state.db.lock();
        db_query::insert_discussion_message(&db, &msg)?;
        // 同步更新轮次
        db_query::update_discussion_round(&db, &discussion_id.0, current_round)?;
    }

    // 3. Emit DiscussionMessage 事件到前端
    let event = ConfluxEvent::DiscussionMessage {
        discussion_id: discussion_id.clone(),
        message: msg.clone(),
        timestamp: msg.created_at,
    };
    emit_conflux_event(&app, &event);

    // MF-10（§13.9）讨论消息注入治理——现状说明：
    // 本命令**只入库（DiscussionEngine + SQLite）+ emit 到前端**，**不**向任何参与
    // agent 的 PTY stdin 写入用户消息（无 inject_stdin / inject_with_policy 调用）。
    // 按契约 §13.9「仅入库不等于已治理注入」，当前路径不构成治理注入，因此无需在此
    // 写注入审计、也不强行造一条注入。
    // 一旦未来把讨论用户消息真正注入到参与 agent stdin，该注入**必须**经唯一入口
    // `inject_with_policy(source=DiscussionUserMessage)`（从而自动写 actor=User /
    // action=DiscussionInjection 审计，MF-2/MF-6），不得旁路裸调 `pty_manager.inject_stdin`。
    Ok(msg)
}

/// 结束指定讨论
///
/// 在内存中结束讨论（生成摘要），并更新数据库状态。
///
/// # 参数
/// - `discussion_id`: 讨论 ID
///
/// # 返回
/// 讨论摘要 DiscussionSummary
#[tauri::command]
pub async fn end_discussion(
    state: State<'_, AppState>,
    discussion_id: DiscussionId,
) -> Result<DiscussionSummary, ConfluxError> {
    // B3.1 Contract 2: Get sandbox_instance_ids BEFORE ending
    // (ending removes the session from memory)
    let (summary, sandbox_ids) = {
        let mut engine = state.discussion_engine.write();
        let sandbox_ids = engine
            .get_session(&discussion_id.0)
            .map(|s| s.sandbox_instance_ids.clone())
            .unwrap_or_default();
        let summary = engine.end(&discussion_id.0)?;
        (summary, sandbox_ids)
    };

    // 2. Destroy all sandbox instances
    for sandbox_id in &sandbox_ids {
        if let Err(e) = state.pty_manager.kill(&sandbox_id.0) {
            log::warn!(
                "end_discussion: failed to kill sandbox instance {}: {:?}",
                sandbox_id.0,
                e
            );
            // Non-fatal: instance may have already exited
        }
        // Clean up instance_adapter_map
        {
            let mut map = state.instance_adapter_map.write();
            map.remove(&sandbox_id.0);
        }
    }

    // 3. 更新数据库状态
    {
        let db = state.db.lock();
        db_query::update_discussion_status(
            &db,
            &discussion_id.0,
            "completed",
            Some(summary.ended_at),
        )?;
    }

    log::debug!(
        "讨论已结束: id={}, rounds={}, sandbox instances destroyed: {}",
        discussion_id.0,
        summary.total_rounds,
        sandbox_ids.len()
    );
    Ok(summary)
}

/// 切换实例的钉选状态（Pin 多选）
///
/// 如果实例已钉选则取消，否则添加。支持同时钉选多个实例。
///
/// # 参数
/// - `instance_id`: 要切换钉选状态的实例 ID
///
/// # 返回
/// 切换后该实例是否处于钉选状态
#[tauri::command]
pub async fn toggle_pin_instance(
    state: State<'_, AppState>,
    instance_id: InstanceId,
) -> Result<bool, ConfluxError> {
    // 验证实例存在
    {
        let map = state.instance_adapter_map.read();
        if !map.contains_key(&instance_id.0) {
            return Err(ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            });
        }
    }

    // 切换钉选
    let is_now_pinned = {
        let mut pinned = state.pinned_instances.write();
        if pinned.contains(&instance_id.0) {
            pinned.remove(&instance_id.0);
            false
        } else {
            pinned.insert(instance_id.0.clone());
            true
        }
    };

    log::debug!(
        "Pin 切换: {} → {}",
        instance_id.0,
        if is_now_pinned { "pinned" } else { "unpinned" }
    );
    Ok(is_now_pinned)
}

/// 获取所有钉选实例 ID 列表
///
/// # 返回
/// 当前所有钉选实例的 ID 列表
#[tauri::command]
pub async fn get_pinned_instances(
    state: State<'_, AppState>,
) -> Result<Vec<InstanceId>, ConfluxError> {
    let pinned = state.pinned_instances.read();
    Ok(pinned.iter().map(|id| InstanceId(id.clone())).collect())
}

/// P1-3 修复：回滚已 spawn 的隐藏 sandbox 实例（kill + instance_adapter_map 清理）。
///
/// 单个 kill 失败不中断后续回滚（实例可能已自行退出），map 条目无论 kill 结果
/// 一律移除——与 destroy_agent_instance「kill 失败仍清理」同语义（mux 契约 MF-4 第 4 条）。
/// 返回成功 kill 的数量（日志用）。kill 经闭包注入以便单测。
fn rollback_spawned_sandboxes<F>(
    mut kill: F,
    instance_adapter_map: &parking_lot::RwLock<std::collections::HashMap<String, String>>,
    sandbox_ids: &[InstanceId],
) -> usize
where
    F: FnMut(&str) -> Result<(), ConfluxError>,
{
    let mut killed = 0;
    for id in sandbox_ids {
        match kill(&id.0) {
            Ok(()) => killed += 1,
            Err(e) => log::warn!(
                "start_discussion 回滚: kill sandbox {} 失败（可能已自行退出）: {:?}",
                id.0,
                e
            ),
        }
        instance_adapter_map.write().remove(&id.0);
    }
    killed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn map_with(ids: &[&str]) -> parking_lot::RwLock<HashMap<String, String>> {
        let mut m = HashMap::new();
        for id in ids {
            m.insert(id.to_string(), "claude-code".to_string());
        }
        parking_lot::RwLock::new(m)
    }

    #[test]
    fn rollback_kills_all_spawned_sandboxes_and_cleans_map() {
        let map = map_with(&["sb-1", "sb-2"]);
        let ids = vec![InstanceId("sb-1".into()), InstanceId("sb-2".into())];
        let mut killed_ids: Vec<String> = Vec::new();

        let killed = rollback_spawned_sandboxes(
            |id| {
                killed_ids.push(id.to_string());
                Ok(())
            },
            &map,
            &ids,
        );

        assert_eq!(killed, 2);
        assert_eq!(killed_ids, vec!["sb-1".to_string(), "sb-2".to_string()]);
        assert!(map.read().is_empty(), "map 条目必须全部清理");
    }

    #[test]
    fn rollback_continues_after_kill_failure_and_still_cleans_map() {
        let map = map_with(&["sb-1", "sb-2"]);
        let ids = vec![InstanceId("sb-1".into()), InstanceId("sb-2".into())];

        let killed = rollback_spawned_sandboxes(
            |id| {
                if id == "sb-1" {
                    Err(ConfluxError::InstanceNotFound {
                        instance_id: id.to_string(),
                    })
                } else {
                    Ok(())
                }
            },
            &map,
            &ids,
        );

        assert_eq!(killed, 1, "kill 失败不应中断后续回滚");
        assert!(
            map.read().is_empty(),
            "kill 失败的实例 map 条目同样必须清理"
        );
    }

    #[test]
    fn rollback_with_no_spawned_sandboxes_is_noop() {
        let map = map_with(&["workspace-1"]);

        let killed = rollback_spawned_sandboxes(|_| Ok(()), &map, &[]);

        assert_eq!(killed, 0);
        assert_eq!(map.read().len(), 1, "非 sandbox 条目不受影响");
    }
}
