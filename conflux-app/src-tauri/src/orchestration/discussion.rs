// ===== Conflux 讨论引擎 =====
// 在内存中管理所有活跃讨论的生命周期
// 支持创建讨论、发送消息（自动轮次递增）、结束讨论并生成摘要
//
// 持久化由 command 层负责：每次操作后同步写入 SQLite

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::core::{
    ConfluxError, DiscussionId, DiscussionMessage, DiscussionMessageData, DiscussionSession,
    DiscussionStatus, DiscussionSummary, InstanceId, MessageSender,
};

/// 讨论引擎——内存中管理活跃讨论
///
/// 核心数据结构:
/// - `sessions`: 讨论 ID -> DiscussionSession（讨论元数据和状态）
/// - `messages`: 讨论 ID -> Vec<DiscussionMessageData>（该讨论的所有消息）
pub struct DiscussionEngine {
    /// 讨论会话映射: discussion_id -> DiscussionSession
    sessions: HashMap<String, DiscussionSession>,
    /// 讨论消息映射: discussion_id -> Vec<DiscussionMessageData>
    messages: HashMap<String, Vec<DiscussionMessageData>>,
}

impl DiscussionEngine {
    /// 创建新的讨论引擎（空状态）
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            messages: HashMap::new(),
        }
    }

    /// 创建一个新的讨论会话
    ///
    /// 分配 UUID 作为讨论 ID，初始状态为 Active，当前轮次为 0。
    /// 会自动向消息列表中添加一条系统消息（讨论开始通知）。
    ///
    /// # 参数
    /// - `topic`: 讨论主题
    /// - `participant_ids`: 参与者的 Agent 实例 ID 列表
    /// - `max_rounds`: 最大讨论轮次
    ///
    /// # 返回
    /// 新创建的 DiscussionSession
    pub fn start(
        &mut self,
        topic: String,
        participant_ids: Vec<InstanceId>,
        sandbox_instance_ids: Vec<InstanceId>,
        max_rounds: u32,
    ) -> DiscussionSession {
        let discussion_id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();

        let session = DiscussionSession {
            id: DiscussionId(discussion_id.clone()),
            topic: topic.clone(),
            participant_ids: participant_ids.clone(),
            sandbox_instance_ids,
            max_rounds,
            current_round: 0,
            status: DiscussionStatus::Active,
            created_at: now,
            ended_at: None,
        };

        // 添加系统开场消息
        let participant_names: Vec<&str> = participant_ids.iter().map(|id| id.0.as_str()).collect();
        let system_msg = DiscussionMessageData {
            id: uuid::Uuid::new_v4().to_string(),
            discussion_id: DiscussionId(discussion_id.clone()),
            sender: MessageSender::System,
            content: format!(
                "讨论开始：「{}」\n参与者：{}\n最大轮次：{}",
                topic,
                participant_names.join(", "),
                max_rounds
            ),
            round: 0,
            created_at: now,
        };

        self.sessions.insert(discussion_id.clone(), session.clone());
        self.messages.insert(discussion_id, vec![system_msg]);

        session
    }

    /// 向指定讨论发送一条消息
    ///
    /// 消息的轮次自动设置为讨论的当前轮次。
    /// 如果当前轮次下消息数达到参与者数量，自动递增轮次。
    /// 如果已达最大轮次，讨论状态不会自动结束（需手动调用 end）。
    ///
    /// # 参数
    /// - `discussion_id`: 讨论 ID
    /// - `content`: 消息内容
    ///
    /// # 返回
    /// 创建的 DiscussionMessage
    ///
    /// # 错误
    /// - 讨论不存在：返回 DiscussionNotFound
    /// - 讨论已结束：返回 OrchestrationError
    pub fn send_message(
        &mut self,
        discussion_id: &str,
        content: String,
        sender: MessageSender,
    ) -> Result<DiscussionMessage, ConfluxError> {
        let session = self.sessions.get_mut(discussion_id).ok_or_else(|| {
            ConfluxError::DiscussionNotFound {
                discussion_id: discussion_id.to_string(),
            }
        })?;

        // 检查讨论是否仍在进行
        if session.status != DiscussionStatus::Active {
            return Err(ConfluxError::OrchestrationError {
                message: format!("讨论 {} 已结束，无法发送消息", discussion_id),
            });
        }

        // 如果当前轮次为 0（刚开始），自动推进到第 1 轮
        if session.current_round == 0 {
            session.current_round = 1;
        }

        let now = now_millis();

        let msg = DiscussionMessageData {
            id: uuid::Uuid::new_v4().to_string(),
            discussion_id: DiscussionId(discussion_id.to_string()),
            sender,
            content,
            round: session.current_round,
            created_at: now,
        };

        // 追加消息
        let messages = self
            .messages
            .entry(discussion_id.to_string())
            .or_insert_with(Vec::new);
        messages.push(msg.clone());

        // 检查是否需要自动推进轮次
        // 当本轮消息数量 >= 参与者数量时，推进到下一轮
        let current_round = session.current_round;
        let messages_in_round = messages
            .iter()
            .filter(|m| m.round == current_round && !matches!(m.sender, MessageSender::System))
            .count();

        let participant_count = session.participant_ids.len();
        if participant_count > 0 && messages_in_round >= participant_count {
            if session.current_round < session.max_rounds {
                session.current_round += 1;
            }
        }

        Ok(msg)
    }

    /// 结束指定讨论并生成摘要
    ///
    /// 将讨论状态设为 Completed，记录结束时间。
    /// 摘要文本包含讨论主题、总轮次、消息统计等信息。
    ///
    /// # 参数
    /// - `discussion_id`: 讨论 ID
    ///
    /// # 返回
    /// 讨论摘要 DiscussionSummary
    ///
    /// # 错误
    /// - 讨论不存在：返回 DiscussionNotFound
    /// - 讨论已结束：返回 OrchestrationError
    pub fn end(&mut self, discussion_id: &str) -> Result<DiscussionSummary, ConfluxError> {
        let session = self.sessions.get_mut(discussion_id).ok_or_else(|| {
            ConfluxError::DiscussionNotFound {
                discussion_id: discussion_id.to_string(),
            }
        })?;

        if session.status != DiscussionStatus::Active {
            return Err(ConfluxError::OrchestrationError {
                message: format!("讨论 {} 已结束，无法重复结束", discussion_id),
            });
        }

        let now = now_millis();
        session.status = DiscussionStatus::Completed;
        session.ended_at = Some(now);

        // 统计消息
        let messages = self.messages.get(discussion_id);
        let total_messages = messages.map(|m| m.len()).unwrap_or(0);
        let user_messages = messages
            .map(|msgs| {
                msgs.iter()
                    .filter(|m| matches!(m.sender, MessageSender::User))
                    .count()
            })
            .unwrap_or(0);
        let agent_messages = messages
            .map(|msgs| {
                msgs.iter()
                    .filter(|m| matches!(m.sender, MessageSender::Agent(_)))
                    .count()
            })
            .unwrap_or(0);

        let summary_text = format!(
            "讨论「{}」已结束。共 {} 轮，{} 条消息（用户 {}、Agent {}、系统 {}）。",
            session.topic,
            session.current_round,
            total_messages,
            user_messages,
            agent_messages,
            total_messages - user_messages - agent_messages,
        );

        let summary = DiscussionSummary {
            discussion_id: DiscussionId(discussion_id.to_string()),
            topic: session.topic.clone(),
            total_rounds: session.current_round,
            summary_text,
            ended_at: now,
        };

        // HIGH-02 修复：结束后从内存中移除，数据已持久化到 SQLite
        self.sessions.remove(discussion_id);
        self.messages.remove(discussion_id);

        Ok(summary)
    }

    /// 获取指定讨论会话（只读引用）
    ///
    /// # 参数
    /// - `discussion_id`: 讨论 ID
    ///
    /// # 返回
    /// 讨论会话的引用，如果不存在则返回 None
    pub fn get_session(&self, discussion_id: &str) -> Option<&DiscussionSession> {
        self.sessions.get(discussion_id)
    }

    /// 获取指定讨论的所有消息（只读引用）
    ///
    /// # 参数
    /// - `discussion_id`: 讨论 ID
    ///
    /// # 返回
    /// 消息列表的引用，如果讨论不存在则返回 None
    pub fn get_messages(&self, discussion_id: &str) -> Option<&Vec<DiscussionMessageData>> {
        self.messages.get(discussion_id)
    }
}

/// 获取当前时间戳（Unix 毫秒）
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_start_discussion() {
        let mut engine = DiscussionEngine::new();
        let session = engine.start(
            "测试主题".to_string(),
            vec![InstanceId("a".to_string()), InstanceId("b".to_string())],
            vec![],
            5,
        );

        assert_eq!(session.topic, "测试主题");
        assert_eq!(session.participant_ids.len(), 2);
        assert_eq!(session.max_rounds, 5);
        assert_eq!(session.current_round, 0);
        assert_eq!(session.status, DiscussionStatus::Active);
        assert!(session.ended_at.is_none());

        // 应有系统开场消息
        let msgs = engine.get_messages(&session.id.0).expect("应有消息列表");
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0].sender, MessageSender::System));
    }

    #[test]
    fn test_send_message_and_round_advance() {
        let mut engine = DiscussionEngine::new();
        let session = engine.start(
            "轮次测试".to_string(),
            vec![InstanceId("a".to_string()), InstanceId("b".to_string())],
            vec![],
            3,
        );
        let disc_id = session.id.0.clone();

        // 发送第一条消息：轮次应从 0 推进到 1
        let msg1 = engine
            .send_message(&disc_id, "消息1".to_string(), MessageSender::User)
            .expect("发送应成功");
        assert_eq!(msg1.round, 1);

        // 发送第二条消息：参与者数=2，两条非系统消息后应推进到 round 2
        let msg2 = engine
            .send_message(&disc_id, "消息2".to_string(), MessageSender::User)
            .expect("发送应成功");
        assert_eq!(msg2.round, 1);

        let session = engine.get_session(&disc_id).expect("讨论应存在");
        assert_eq!(session.current_round, 2);
    }

    #[test]
    fn test_end_discussion() {
        let mut engine = DiscussionEngine::new();
        let session = engine.start("结束测试".to_string(), vec![], vec![], 3);
        let disc_id = session.id.0.clone();

        engine
            .send_message(&disc_id, "消息".to_string(), MessageSender::User)
            .expect("发送应成功");

        let summary = engine.end(&disc_id).expect("结束应成功");
        assert_eq!(summary.topic, "结束测试");
        assert!(summary.ended_at > 0);

        // 再次结束应报错
        let result = engine.end(&disc_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_send_message_to_ended_discussion() {
        let mut engine = DiscussionEngine::new();
        let session = engine.start("已结束测试".to_string(), vec![], vec![], 3);
        let disc_id = session.id.0.clone();

        engine.end(&disc_id).expect("结束应成功");

        let result = engine.send_message(&disc_id, "不应成功".to_string(), MessageSender::User);
        assert!(result.is_err());
    }

    #[test]
    fn test_nonexistent_discussion() {
        let mut engine = DiscussionEngine::new();
        let result = engine.send_message("nonexistent", "test".to_string(), MessageSender::User);
        assert!(result.is_err());

        let result = engine.end("nonexistent");
        assert!(result.is_err());

        assert!(engine.get_session("nonexistent").is_none());
    }
}
