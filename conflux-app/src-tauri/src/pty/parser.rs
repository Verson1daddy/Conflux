// ===== Conflux PTY 输出状态机解析器 =====
//
// 核心职责:
//   将 PTY 进程的原始字节流解析为结构化事件（ConfluxEvent）。
//   桥接 OutputBuffer（原始字节）和 AgentAdapter（行级解析）之间的鸿沟。
//
// 数据流:
//   PTY 读取线程 → OutputBuffer → feed(raw_bytes) → 逐行 → adapter.parse_output(line)
//                                                       → patch_instance_id
//                                                       → 状态去重
//                                                       → AgentTree 维护
//                                                       → Vec<ConfluxEvent>
//
// 线程安全:
//   PtyOutputParser 本身不是 Send+Sync——由外层锁（如 Mutex<PtyOutputParser>）保护。
//   adapter 字段使用 Arc<dyn AgentAdapter>，满足跨线程共享要求。

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;

use crate::adapter::traits::AgentAdapter;
use crate::core::{
    AgentStatus, AgentTree, ConfluxEvent, ErrorSeverity, InstanceId, PermissionRequest,
    SubAgentInfo,
};

/// ANSI 转义序列匹配正则（预编译，线程局部缓存）
///
/// HIGH-03 修复：覆盖多种转义序列类型：
/// - CSI 序列：`\x1b[0;31m`（颜色、光标移动等）
/// - OSC 序列：`\x1b]0;title\x07`（窗口标题、超链接等）
/// - DCS 序列：`\x1bP...\x1b\\`（设备控制字符串）
/// - 单字符 ESC 序列：`\x1b=`、`\x1bM` 等（键盘模式切换等）
/// - 字符集选择：`\x1b(A` 等
fn ansi_regex() -> &'static Regex {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?x)
            \x1b \[ [0-9;]* [A-Za-z]       # CSI 序列
            | \x1b \] [^\x07]* \x07         # OSC 序列（BEL 终止）
            | \x1b \] [^\x1b]* \x1b \\     # OSC 序列（ST 终止）
            | \x1b P [^\x1b]* \x1b \\      # DCS 序列
            | \x1b \( [A-Z]                  # 字符集选择
            | \x1b [=>78MNOPX]               # 单字符 ESC 序列
            ",
        )
        .expect("ANSI 正则编译失败")
    })
}

/// PTY 输出解析器——将原始 PTY 字节流转换为结构化事件
///
/// 使用方式：
/// 1. 创建解析器：`PtyOutputParser::new(instance_id, adapter, adapter_name)`
/// 2. 反复调用 `feed(raw_bytes)` 喂入 PTY 输出字节
/// 3. 收集返回的 `Vec<ConfluxEvent>` 发送到事件总线
/// 4. 随时通过 `current_status()` / `get_tree()` / `recent_lines()` 查询状态
pub struct PtyOutputParser {
    /// 当前 Agent 实例 ID（用于替换适配器返回的 placeholder）
    instance_id: InstanceId,
    /// 框架适配器（提供 parse_output 行级解析能力）
    adapter: Arc<dyn AgentAdapter>,
    /// 当前 Agent 状态（状态机当前状态，用于去重）
    current_status: AgentStatus,
    /// Agent 树结构（追踪 sub-agent 生成和完成）
    agent_tree: AgentTree,
    /// 未完成行的缓冲区（跨 feed 调用保留不完整行）
    line_buffer: String,
    /// 最近 N 行输出缓存（用于 PermissionRequest.raw_context）
    recent_lines: Vec<String>,
    /// 最大缓存行数
    max_recent_lines: usize,
}

impl PtyOutputParser {
    /// 创建新的 PTY 输出解析器
    ///
    /// # Arguments
    /// * `instance_id` - 当前 Agent 实例的唯一标识
    /// * `adapter` - 框架适配器（Arc 共享，用于调用 parse_output）
    /// * `adapter_name` - 适配器显示名称（用于 AgentTree root 节点名称）
    ///
    /// # 初始化状态
    /// - `current_status` 为 `AgentStatus::Idle`
    /// - `agent_tree` 的 root 节点使用 instance_id 和 adapter_name
    /// - `max_recent_lines` 默认 10
    pub fn new(
        instance_id: InstanceId,
        adapter: Arc<dyn AgentAdapter>,
        adapter_name: &str,
    ) -> Self {
        let root = SubAgentInfo {
            id: instance_id.0.clone(),
            name: adapter_name.to_string(),
            status: AgentStatus::Idle,
            parent_id: None,
        };

        let agent_tree = AgentTree {
            root,
            children: Vec::new(),
        };

        Self {
            instance_id,
            adapter,
            current_status: AgentStatus::Idle,
            agent_tree,
            line_buffer: String::new(),
            recent_lines: Vec::new(),
            max_recent_lines: 10,
        }
    }

    /// 处理一批原始字节，返回产生的事件列表
    ///
    /// 字节来自 OutputBuffer，可能跨行边界。解析流程：
    /// 1. 将 raw_bytes 转为 UTF-8（lossy，无效字节替换为 U+FFFD）
    /// 2. 追加到 line_buffer
    /// 3. 按 `\n` 分割为完整行和不完整尾部
    /// 4. 对每一完整行：剥离 ANSI → 调用 adapter.parse_output → patch_instance_id → 状态去重 → 树维护
    /// 5. 不完整尾部保留在 line_buffer，等待下次 feed
    ///
    /// # Arguments
    /// * `raw_bytes` - PTY 输出的原始字节切片
    ///
    /// # Returns
    /// 本次 feed 产生的所有事件列表（可能为空）
    pub fn feed(&mut self, raw_bytes: &[u8]) -> Vec<ConfluxEvent> {
        if raw_bytes.is_empty() {
            return Vec::new();
        }

        // UTF-8 lossy 转换——无效字节替换为 U+FFFD，不会 panic
        let text = String::from_utf8_lossy(raw_bytes);
        self.line_buffer.push_str(&text);

        let mut events = Vec::new();

        // 按 \n 分割——保留最后一段（可能不完整）在 line_buffer
        // 使用 split('\n') 而非 lines() 以正确处理尾部行为
        let parts: Vec<&str> = self.line_buffer.split('\n').collect();
        let (complete_lines, remainder) = parts.split_at(parts.len() - 1);

        // 收集完整行（需要 clone 因为 line_buffer 即将被替换）
        let lines: Vec<String> = complete_lines.iter().map(|s| s.to_string()).collect();
        // 保留不完整尾部
        self.line_buffer = remainder.last().unwrap_or(&"").to_string();

        for raw_line in lines {
            // 剥离 \r（处理 \r\n 行尾）
            let trimmed = raw_line.trim_end_matches('\r');

            // 跳过空行
            if trimmed.is_empty() {
                continue;
            }

            // 剥离 ANSI 转义序列
            let clean_line = strip_ansi(trimmed);

            // 跳过剥离后为空的行（纯 ANSI 控制序列行）
            if clean_line.is_empty() {
                continue;
            }

            // 加入最近行缓存
            self.push_recent_line(&clean_line);

            // 调用适配器解析
            if let Some(event) = self.adapter.parse_output(&clean_line) {
                // 替换 placeholder instance_id
                let patched = self.patch_instance_id(event);

                // 处理事件——状态去重、树维护、合成衍生事件
                let processed = self.process_event(patched);
                events.extend(processed);
            }
        }

        events
    }

    /// 获取当前 Agent 状态
    pub fn current_status(&self) -> &AgentStatus {
        &self.current_status
    }

    /// 获取当前 AgentTree 快照
    ///
    /// 返回完整的树结构克隆，包含 root 节点和所有 sub-agent 子节点。
    /// root 节点的 status 会同步为解析器当前跟踪的状态。
    pub fn get_tree(&self) -> AgentTree {
        let mut tree = self.agent_tree.clone();
        // 同步 root 节点状态到解析器的当前跟踪状态
        tree.root.status = self.current_status.clone();
        tree
    }

    /// 获取最近 N 行输出（用于 PermissionRequest.raw_context）
    ///
    /// 返回按时间顺序排列的最近行，最旧在前、最新在后。
    pub fn recent_lines(&self) -> &[String] {
        &self.recent_lines
    }

    /// 将 adapter 返回的事件中的 placeholder `InstanceId("unknown")` 替换为真实 instance_id
    ///
    /// 遍历所有 ConfluxEvent 变体，将所有 `InstanceId("unknown")` 替换为 `self.instance_id`。
    /// 对 PermissionRequested 变体，还会用 recent_lines 补充 raw_context。
    fn patch_instance_id(&self, event: ConfluxEvent) -> ConfluxEvent {
        let real_id = &self.instance_id;
        let unknown = "unknown";

        match event {
            ConfluxEvent::AgentStatusChanged {
                instance_id,
                old_status,
                new_status,
                timestamp,
            } => ConfluxEvent::AgentStatusChanged {
                instance_id: patch_id(instance_id, real_id, unknown),
                old_status,
                new_status,
                timestamp,
            },

            ConfluxEvent::PermissionRequested {
                instance_id,
                request,
                timestamp,
            } => {
                // 补充 raw_context 为最近行缓存内容
                let raw_context = self.recent_lines.clone();
                let patched_request = PermissionRequest {
                    instance_id: patch_id(request.instance_id, real_id, unknown),
                    raw_context,
                    ..request
                };
                ConfluxEvent::PermissionRequested {
                    instance_id: patch_id(instance_id, real_id, unknown),
                    request: patched_request,
                    timestamp,
                }
            }

            ConfluxEvent::SubAgentSpawned {
                instance_id,
                sub_agent,
                timestamp,
            } => {
                let patched_sub = SubAgentInfo {
                    parent_id: Some(real_id.0.clone()),
                    ..sub_agent
                };
                ConfluxEvent::SubAgentSpawned {
                    instance_id: patch_id(instance_id, real_id, unknown),
                    sub_agent: patched_sub,
                    timestamp,
                }
            }

            ConfluxEvent::SubAgentCompleted {
                instance_id,
                sub_agent_id,
                result_summary,
                timestamp,
            } => ConfluxEvent::SubAgentCompleted {
                instance_id: patch_id(instance_id, real_id, unknown),
                sub_agent_id,
                result_summary,
                timestamp,
            },

            ConfluxEvent::TaskCompleted {
                instance_id,
                summary,
                timestamp,
            } => ConfluxEvent::TaskCompleted {
                instance_id: patch_id(instance_id, real_id, unknown),
                summary,
                timestamp,
            },

            ConfluxEvent::ErrorOccurred {
                instance_id,
                error_message,
                severity,
                timestamp,
            } => ConfluxEvent::ErrorOccurred {
                instance_id: patch_id(instance_id, real_id, unknown),
                error_message,
                severity,
                timestamp,
            },

            ConfluxEvent::PtyOutput {
                instance_id,
                data,
                seq,
                timestamp,
            } => ConfluxEvent::PtyOutput {
                instance_id: patch_id(instance_id, real_id, unknown),
                data,
                seq,
                timestamp,
            },

            ConfluxEvent::StdinInjected {
                instance_id,
                source,
                content_preview,
                content_length,
                timestamp,
            } => ConfluxEvent::StdinInjected {
                instance_id: patch_id(instance_id, real_id, unknown),
                source,
                content_preview,
                content_length,
                timestamp,
            },

            // DiscussionMessage 和 CoordinationCommand 不包含需要替换的 placeholder
            // 但为完备性仍然处理 CoordinationCommand
            ConfluxEvent::CoordinationCommand {
                target_instance_id,
                command_text,
                source_discussion_id,
                timestamp,
            } => ConfluxEvent::CoordinationCommand {
                target_instance_id: patch_id(target_instance_id, real_id, unknown),
                command_text,
                source_discussion_id,
                timestamp,
            },

            // DiscussionMessage 不含 instance_id placeholder，直接透传
            other => other,
        }
    }

    /// 处理事件——状态去重、树维护和合成衍生事件
    ///
    /// 返回需要发出的事件列表（可能为空表示被去重过滤，可能多于一个表示合成了衍生事件）。
    /// 当 Agent 状态变为 Done 时，额外合成 TaskCompleted 事件。
    /// 当 Agent 状态变为 Error 时，额外合成 ErrorOccurred 事件。
    fn process_event(&mut self, event: ConfluxEvent) -> Vec<ConfluxEvent> {
        match &event {
            ConfluxEvent::AgentStatusChanged { new_status, .. } => {
                // 状态去重：仅在状态真正变化时发出事件
                if *new_status == self.current_status {
                    return Vec::new();
                }

                let old_status = self.current_status.clone();
                self.current_status = new_status.clone();

                // 同步更新 AgentTree root 节点状态
                self.agent_tree.root.status = new_status.clone();

                // 重建事件，使用真实的 old_status（适配器返回的 old_status 是占位的 Idle）
                if let ConfluxEvent::AgentStatusChanged {
                    instance_id,
                    new_status,
                    timestamp,
                    ..
                } = event
                {
                    let mut events_out = Vec::new();

                    // 主事件：状态变化
                    events_out.push(ConfluxEvent::AgentStatusChanged {
                        instance_id: instance_id.clone(),
                        old_status,
                        new_status: new_status.clone(),
                        timestamp,
                    });

                    // 合成衍生事件：Done → TaskCompleted
                    if new_status == AgentStatus::Done {
                        events_out.push(ConfluxEvent::TaskCompleted {
                            instance_id: instance_id.clone(),
                            summary: "Agent completed task".to_string(),
                            timestamp: now_millis(),
                        });
                    }

                    // 合成衍生事件：Error → ErrorOccurred
                    if new_status == AgentStatus::Error {
                        events_out.push(ConfluxEvent::ErrorOccurred {
                            instance_id: instance_id.clone(),
                            error_message: self
                                .recent_lines
                                .last()
                                .cloned()
                                .unwrap_or_else(|| "Unknown error".to_string()),
                            severity: ErrorSeverity::Error,
                            timestamp: now_millis(),
                        });
                    }

                    events_out
                } else {
                    // 不可达，但为 match 完备性保留
                    vec![event]
                }
            }

            ConfluxEvent::SubAgentSpawned { sub_agent, .. } => {
                // 将新 sub-agent 加入树
                let child_tree = AgentTree {
                    root: sub_agent.clone(),
                    children: Vec::new(),
                };
                self.agent_tree.children.push(child_tree);
                vec![event]
            }

            ConfluxEvent::SubAgentCompleted { sub_agent_id, .. } => {
                // 更新 sub-agent 状态为 Done
                update_sub_agent_status(&mut self.agent_tree, sub_agent_id, &AgentStatus::Done);
                vec![event]
            }

            // 其他事件直接透传
            _ => vec![event],
        }
    }

    /// 将一行输出加入最近行缓存
    ///
    /// 当缓存达到 max_recent_lines 时，移除最旧的一行。
    fn push_recent_line(&mut self, line: &str) {
        if self.recent_lines.len() >= self.max_recent_lines {
            self.recent_lines.remove(0);
        }
        self.recent_lines.push(line.to_string());
    }
}

/// 获取当前时间戳（Unix 毫秒）
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 剥离 ANSI 转义序列
///
/// 移除标准 CSI 序列（`\x1b[...X`），返回纯文本。
fn strip_ansi(input: &str) -> String {
    ansi_regex().replace_all(input, "").to_string()
}

/// 替换 placeholder InstanceId
///
/// 如果 `id.0 == unknown_value`，则替换为 `real_id` 的克隆；否则保持原值。
fn patch_id(id: InstanceId, real_id: &InstanceId, unknown_value: &str) -> InstanceId {
    if id.0 == unknown_value {
        real_id.clone()
    } else {
        id
    }
}

/// 递归更新 AgentTree 中指定 sub-agent 的状态
///
/// 深度优先搜索树中 id 匹配的节点，更新其 status。
fn update_sub_agent_status(tree: &mut AgentTree, sub_agent_id: &str, status: &AgentStatus) {
    for child in &mut tree.children {
        if child.root.id == sub_agent_id {
            child.root.status = status.clone();
            return;
        }
        // 递归搜索子树
        update_sub_agent_status(child, sub_agent_id, status);
    }
}

// ===== 单元测试 =====

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{
        AdapterCapabilities, AgentStatus, ConfluxEvent, InstanceId, PermissionRequest,
        PermissionStatus, SubAgentInfo,
    };
    use async_trait::async_trait;

    /// 测试用 Mock 适配器——根据行内容返回预设事件
    struct MockAdapter {
        name: String,
        capabilities: AdapterCapabilities,
    }

    impl MockAdapter {
        fn new() -> Self {
            Self {
                name: "mock-adapter".to_string(),
                capabilities: AdapterCapabilities {
                    can_coordinate: false,
                    coordination_template: None,
                    can_parse_tree: true,
                    can_detect_permission: true,
                },
            }
        }
    }

    #[async_trait]
    impl AgentAdapter for MockAdapter {
        fn name(&self) -> &str {
            &self.name
        }

        fn capabilities(&self) -> &AdapterCapabilities {
            &self.capabilities
        }

        async fn spawn(
            &self,
            _working_dir: &str,
            _args: &[String],
        ) -> Result<Box<dyn crate::adapter::traits::AgentInstance>, crate::core::ConfluxError>
        {
            unreachable!("MockAdapter::spawn 不应在解析器测试中被调用")
        }

        fn parse_output(&self, raw_line: &str) -> Option<ConfluxEvent> {
            let placeholder_id = InstanceId("unknown".to_string());
            let now = 1000;

            if raw_line.contains("Thinking") {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::Thinking,
                    timestamp: now,
                });
            }

            if raw_line.contains("Coding") {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::Coding,
                    timestamp: now,
                });
            }

            if raw_line.contains("Done") {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::Done,
                    timestamp: now,
                });
            }

            if raw_line.contains("Error") {
                return Some(ConfluxEvent::AgentStatusChanged {
                    instance_id: placeholder_id,
                    old_status: AgentStatus::Idle,
                    new_status: AgentStatus::Error,
                    timestamp: now,
                });
            }

            if raw_line.contains("Permission") {
                return Some(ConfluxEvent::PermissionRequested {
                    instance_id: placeholder_id.clone(),
                    request: PermissionRequest {
                        id: "perm-001".to_string(),
                        instance_id: InstanceId("unknown".to_string()),
                        action: "file_write".to_string(),
                        description: raw_line.to_string(),
                        raw_context: vec![raw_line.to_string()],
                        status: PermissionStatus::Pending,
                        created_at: now,
                        timeout_seconds: 120,
                        signal_source: crate::core::PermissionSignalSource::Scrape,
                    },
                    timestamp: now,
                });
            }

            if raw_line.contains("SpawnAgent") {
                return Some(ConfluxEvent::SubAgentSpawned {
                    instance_id: placeholder_id,
                    sub_agent: SubAgentInfo {
                        id: "sub-001".to_string(),
                        name: "worker-1".to_string(),
                        status: AgentStatus::Idle,
                        parent_id: None,
                    },
                    timestamp: now,
                });
            }

            if raw_line.contains("AgentComplete") {
                return Some(ConfluxEvent::SubAgentCompleted {
                    instance_id: placeholder_id,
                    sub_agent_id: "sub-001".to_string(),
                    result_summary: Some("task done".to_string()),
                    timestamp: now,
                });
            }

            None
        }
    }

    fn make_parser() -> PtyOutputParser {
        let adapter = Arc::new(MockAdapter::new());
        PtyOutputParser::new(
            InstanceId("test-instance-001".to_string()),
            adapter,
            "MockAgent",
        )
    }

    // ----- test_basic_line_parsing -----
    // 验证基本行分割：单行和多行输入均能被正确解析
    #[test]
    fn test_basic_line_parsing() {
        let mut parser = make_parser();

        // 单行输入（带换行符）
        let events = parser.feed(b"Thinking about the problem\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged { new_status, .. } => {
                assert_eq!(*new_status, AgentStatus::Thinking);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }

        // 多行输入——第二行触发 Coding 事件
        let events = parser.feed(b"some normal output\nCoding the solution\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged { new_status, .. } => {
                assert_eq!(*new_status, AgentStatus::Coding);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }
    }

    // ----- test_status_change_dedup -----
    // 验证连续相同状态不重复发事件
    #[test]
    fn test_status_change_dedup() {
        let mut parser = make_parser();

        // 第一次 Thinking → 应该产生事件
        let events = parser.feed(b"Thinking step 1\n");
        assert_eq!(events.len(), 1);
        assert_eq!(*parser.current_status(), AgentStatus::Thinking);

        // 第二次 Thinking → 应该被去重，不产生事件
        let events = parser.feed(b"Thinking step 2\n");
        assert_eq!(events.len(), 0);
        assert_eq!(*parser.current_status(), AgentStatus::Thinking);

        // 切换到 Coding → 应该产生事件
        let events = parser.feed(b"Coding now\n");
        assert_eq!(events.len(), 1);
        assert_eq!(*parser.current_status(), AgentStatus::Coding);

        // 再次 Coding → 去重
        let events = parser.feed(b"Coding more\n");
        assert_eq!(events.len(), 0);

        // 验证去重后的事件 old_status 正确
        // Done 状态变化会额外合成 TaskCompleted 事件，所以期望 2 个事件
        let events = parser.feed(b"Done with task\n");
        assert_eq!(events.len(), 2);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged {
                old_status,
                new_status,
                ..
            } => {
                assert_eq!(*old_status, AgentStatus::Coding);
                assert_eq!(*new_status, AgentStatus::Done);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }
        // 验证合成的 TaskCompleted 事件
        match &events[1] {
            ConfluxEvent::TaskCompleted {
                instance_id,
                summary,
                ..
            } => {
                assert_eq!(*instance_id, InstanceId("test-instance-001".to_string()));
                assert_eq!(summary, "Agent completed task");
            }
            other => panic!("期望 TaskCompleted，实际得到 {:?}", other),
        }
    }

    // ----- test_instance_id_patching -----
    // 验证 placeholder InstanceId("unknown") 被正确替换为真实 ID
    #[test]
    fn test_instance_id_patching() {
        let mut parser = make_parser();
        let real_id = InstanceId("test-instance-001".to_string());

        // AgentStatusChanged
        let events = parser.feed(b"Thinking about it\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged { instance_id, .. } => {
                assert_eq!(*instance_id, real_id);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }

        // PermissionRequested
        let events = parser.feed(b"Permission needed for file_write\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::PermissionRequested {
                instance_id,
                request,
                ..
            } => {
                assert_eq!(*instance_id, real_id);
                assert_eq!(request.instance_id, real_id);
            }
            other => panic!("期望 PermissionRequested，实际得到 {:?}", other),
        }

        // SubAgentSpawned — 验证 parent_id 被设为真实 ID
        let events = parser.feed(b"SpawnAgent worker\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::SubAgentSpawned {
                instance_id,
                sub_agent,
                ..
            } => {
                assert_eq!(*instance_id, real_id);
                assert_eq!(sub_agent.parent_id, Some("test-instance-001".to_string()));
            }
            other => panic!("期望 SubAgentSpawned，实际得到 {:?}", other),
        }
    }

    // ----- test_partial_line_buffering -----
    // 验证跨 feed 调用的不完整行处理
    #[test]
    fn test_partial_line_buffering() {
        let mut parser = make_parser();

        // 第一次 feed：不完整行，没有换行符
        let events = parser.feed(b"Think");
        assert_eq!(events.len(), 0, "不完整行不应产生事件");

        // 第二次 feed：补全行
        let events = parser.feed(b"ing about it\n");
        assert_eq!(events.len(), 1, "补全后应该产生一个事件");
        match &events[0] {
            ConfluxEvent::AgentStatusChanged { new_status, .. } => {
                assert_eq!(*new_status, AgentStatus::Thinking);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }

        // 第三次 feed：多个不完整段
        let events = parser.feed(b"Cod");
        assert_eq!(events.len(), 0);
        let events = parser.feed(b"ing the");
        assert_eq!(events.len(), 0);
        let events = parser.feed(b" code\nDone!\n");
        assert_eq!(
            events.len(),
            3,
            "应该产生 Coding、Done 和 TaskCompleted 三个事件"
        );
    }

    // ----- test_agent_tree_tracking -----
    // 验证 sub-agent 生成和完成后树结构正确
    #[test]
    fn test_agent_tree_tracking() {
        let mut parser = make_parser();

        // 初始树：仅有 root 节点
        let tree = parser.get_tree();
        assert_eq!(tree.root.id, "test-instance-001");
        assert_eq!(tree.root.name, "MockAgent");
        assert_eq!(tree.root.status, AgentStatus::Idle);
        assert!(tree.children.is_empty());

        // 生成 sub-agent
        let events = parser.feed(b"SpawnAgent worker-1\n");
        assert_eq!(events.len(), 1);

        let tree = parser.get_tree();
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].root.id, "sub-001");
        assert_eq!(tree.children[0].root.name, "worker-1");
        assert_eq!(tree.children[0].root.status, AgentStatus::Idle);
        assert_eq!(
            tree.children[0].root.parent_id,
            Some("test-instance-001".to_string())
        );

        // 完成 sub-agent
        let events = parser.feed(b"AgentComplete sub-001\n");
        assert_eq!(events.len(), 1);

        let tree = parser.get_tree();
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].root.status, AgentStatus::Done);
    }

    // ----- test_ansi_stripping -----
    // 验证 ANSI 转义序列被正确剥离
    #[test]
    fn test_ansi_stripping() {
        let mut parser = make_parser();

        // 包含 ANSI 颜色代码的输出
        let events = parser.feed(b"\x1b[32mThinking about it\x1b[0m\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged { new_status, .. } => {
                assert_eq!(*new_status, AgentStatus::Thinking);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }
    }

    // ----- test_crlf_handling -----
    // 验证 \r\n 行尾被正确处理
    #[test]
    fn test_crlf_handling() {
        let mut parser = make_parser();

        let events = parser.feed(b"Thinking about it\r\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged { new_status, .. } => {
                assert_eq!(*new_status, AgentStatus::Thinking);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }
    }

    // ----- test_recent_lines_cache -----
    // 验证最近行缓存的容量限制和 FIFO 行为
    #[test]
    fn test_recent_lines_cache() {
        let mut parser = make_parser();

        // 喂入 15 行（超过默认 max_recent_lines=10）
        let mut input = String::new();
        for i in 0..15 {
            input.push_str(&format!("line {}\n", i));
        }
        parser.feed(input.as_bytes());

        let lines = parser.recent_lines();
        assert_eq!(lines.len(), 10, "缓存应限制为 10 行");
        assert_eq!(lines[0], "line 5", "最旧的行应该是 line 5");
        assert_eq!(lines[9], "line 14", "最新的行应该是 line 14");
    }

    // ----- test_permission_raw_context -----
    // 验证 PermissionRequested 事件的 raw_context 被填充为最近行
    #[test]
    fn test_permission_raw_context() {
        let mut parser = make_parser();

        // 先喂入一些上下文行
        parser.feed(b"context line 1\ncontext line 2\ncontext line 3\n");

        // 触发权限请求
        let events = parser.feed(b"Permission needed for file_write\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::PermissionRequested { request, .. } => {
                // raw_context 应包含之前的上下文行 + 当前权限请求行
                assert_eq!(request.raw_context.len(), 4);
                assert_eq!(request.raw_context[0], "context line 1");
                assert_eq!(request.raw_context[3], "Permission needed for file_write");
            }
            other => panic!("期望 PermissionRequested，实际得到 {:?}", other),
        }
    }

    // ----- test_empty_input -----
    // 验证空输入不会产生事件或异常
    #[test]
    fn test_empty_input() {
        let mut parser = make_parser();

        let events = parser.feed(b"");
        assert!(events.is_empty());

        let events = parser.feed(b"\n\n\n");
        assert!(events.is_empty(), "纯空行不应产生事件");
    }

    // ----- test_old_status_in_status_change_event -----
    // 验证状态变化事件中的 old_status 正确反映真实的前一状态
    #[test]
    fn test_old_status_in_status_change_event() {
        let mut parser = make_parser();

        // Idle -> Thinking
        let events = parser.feed(b"Thinking\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged {
                old_status,
                new_status,
                ..
            } => {
                assert_eq!(*old_status, AgentStatus::Idle);
                assert_eq!(*new_status, AgentStatus::Thinking);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }

        // Thinking -> Coding
        let events = parser.feed(b"Coding\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged {
                old_status,
                new_status,
                ..
            } => {
                assert_eq!(*old_status, AgentStatus::Thinking);
                assert_eq!(*new_status, AgentStatus::Coding);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }

        // Coding -> Done（合成 TaskCompleted，共 2 个事件）
        let events = parser.feed(b"Done\n");
        assert_eq!(events.len(), 2);
        match &events[0] {
            ConfluxEvent::AgentStatusChanged {
                old_status,
                new_status,
                ..
            } => {
                assert_eq!(*old_status, AgentStatus::Coding);
                assert_eq!(*new_status, AgentStatus::Done);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }
        match &events[1] {
            ConfluxEvent::TaskCompleted { .. } => {}
            other => panic!("期望 TaskCompleted，实际得到 {:?}", other),
        }
    }

    // ----- test_done_synthesizes_task_completed -----
    // 验证 Done 状态变化会合成 TaskCompleted 事件
    #[test]
    fn test_done_synthesizes_task_completed() {
        let mut parser = make_parser();

        let events = parser.feed(b"Thinking about it\n");
        assert_eq!(events.len(), 1);

        let events = parser.feed(b"Done with everything\n");
        assert_eq!(
            events.len(),
            2,
            "Done 应产生 AgentStatusChanged + TaskCompleted"
        );

        match &events[0] {
            ConfluxEvent::AgentStatusChanged { new_status, .. } => {
                assert_eq!(*new_status, AgentStatus::Done);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }

        match &events[1] {
            ConfluxEvent::TaskCompleted {
                instance_id,
                summary,
                ..
            } => {
                assert_eq!(*instance_id, InstanceId("test-instance-001".to_string()));
                assert_eq!(summary, "Agent completed task");
            }
            other => panic!("期望 TaskCompleted，实际得到 {:?}", other),
        }
    }

    // ----- test_error_synthesizes_error_occurred -----
    // 验证 Error 状态变化会合成 ErrorOccurred 事件
    #[test]
    fn test_error_synthesizes_error_occurred() {
        use crate::core::ErrorSeverity;

        let mut parser = make_parser();

        // 先输入一些上下文
        parser.feed(b"some context line\n");
        parser.feed(b"the actual error message\n");

        let events = parser.feed(b"Error occurred\n");
        assert_eq!(
            events.len(),
            2,
            "Error 应产生 AgentStatusChanged + ErrorOccurred"
        );

        match &events[0] {
            ConfluxEvent::AgentStatusChanged { new_status, .. } => {
                assert_eq!(*new_status, AgentStatus::Error);
            }
            other => panic!("期望 AgentStatusChanged，实际得到 {:?}", other),
        }

        match &events[1] {
            ConfluxEvent::ErrorOccurred {
                instance_id,
                error_message,
                severity,
                ..
            } => {
                assert_eq!(*instance_id, InstanceId("test-instance-001".to_string()));
                // recent_lines 的最后一行是 "Error occurred"（当前行已被 push 进去）
                assert_eq!(error_message, "Error occurred");
                assert_eq!(*severity, ErrorSeverity::Error);
            }
            other => panic!("期望 ErrorOccurred，实际得到 {:?}", other),
        }
    }
}
