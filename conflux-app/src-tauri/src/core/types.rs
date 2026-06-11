// ===== Conflux 核心数据类型 =====
// 本文件定义所有标识符、状态枚举、数据结构体
// 对应前端 TypeScript 类型定义（位于 src/types/ 目录）
// 所有类型均通过 serde 序列化/反序列化，用于 Tauri IPC 通信

use serde::{Deserialize, Serialize};

// ===== 标识符类型（Newtype 模式） =====

/// Agent 实例唯一标识
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct InstanceId(pub String);

/// 适配器唯一标识
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AdapterId(pub String);

/// 讨论会话唯一标识
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DiscussionId(pub String);

// ===== Agent 运行模式 =====

/// Agent 运行权限模式
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    /// 完全权限：可读写文件、执行命令、自动操作
    Full,
    /// 沙箱权限：只读，受限工具集，不可写文件或执行危险命令
    Sandbox,
}

impl Default for AgentMode {
    fn default() -> Self {
        AgentMode::Full
    }
}

// ===== Agent 状态 =====

/// Agent 运行状态枚举
/// serde rename_all = "snake_case" 使得：
///   Idle -> "idle", Thinking -> "thinking", WaitingPermission -> "waiting_permission"
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    /// 空闲
    Idle,
    /// 思考/推理中
    Thinking,
    /// 编写代码中
    Coding,
    /// 等待用户权限确认
    WaitingPermission,
    /// 任务完成
    Done,
    /// 错误状态
    Error,
}

/// Agent 状态详情（含上下文信息，用于 get_agent_state 命令返回）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStateDetail {
    /// 实例唯一 ID
    pub instance_id: InstanceId,
    /// 所属适配器 ID
    pub adapter_id: AdapterId,
    /// 适配器显示名称
    pub adapter_name: String,
    /// 用户自定义别名（B4: 命名后缀）
    pub display_name: Option<String>,
    /// 当前运行状态
    pub status: AgentStatus,
    /// 工作目录
    pub working_dir: String,
    /// 是否为钉选实例（灵动岛主框架）
    pub is_pinned: bool,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
    /// 最后活动时间（Unix 时间戳 ms）
    pub last_activity_at: i64,
    /// 结束时间（Unix 时间戳 ms）；仍在运行时为 None
    pub ended_at: Option<i64>,
    /// 运行模式（B3.1 Contract 3）
    pub mode: AgentMode,
    /// 是否为隐藏实例（B3.1 Contract 3）
    pub hidden: bool,
    /// Sub-agent 列表（扁平化，不含根节点）
    pub sub_agents: Vec<SubAgentInfo>,
}

/// Agent 状态（简化版，用于 AgentInstance trait）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    /// 当前运行状态
    pub status: AgentStatus,
    /// 最后活动时间（Unix 时间戳 ms）
    pub last_activity_at: i64,
}

// ===== Sub-Agent =====

/// Sub-agent 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubAgentInfo {
    /// Sub-agent 标识（框架内部 ID，字符串形式）
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 当前状态
    pub status: AgentStatus,
    /// 父 agent ID（顶级 agent 的 parent_id 为 None）
    pub parent_id: Option<String>,
}

/// Agent 树结构（递归）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTree {
    /// 根节点信息
    pub root: SubAgentInfo,
    /// 子节点列表（递归）
    pub children: Vec<AgentTree>,
}

// ===== 讨论 =====

/// 讨论会话状态枚举
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscussionStatus {
    /// 进行中
    Active,
    /// 已完成
    Completed,
    /// 已取消
    Cancelled,
}

/// 讨论会话
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscussionSession {
    /// 讨论 ID
    pub id: DiscussionId,
    /// 讨论主题
    pub topic: String,
    /// 参与者实例 ID 列表
    pub participant_ids: Vec<InstanceId>,
    /// 讨论专用隐藏 sandbox 实例 ID（消息注入目标，B3.1 Contract 2）
    pub sandbox_instance_ids: Vec<InstanceId>,
    /// 最大讨论轮次
    pub max_rounds: u32,
    /// 当前轮次
    pub current_round: u32,
    /// 讨论状态
    pub status: DiscussionStatus,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
    /// 结束时间（Unix 时间戳 ms），None 表示尚未结束
    pub ended_at: Option<i64>,
}

/// 讨论消息数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscussionMessageData {
    /// 消息 ID
    pub id: String,
    /// 所属讨论 ID
    pub discussion_id: DiscussionId,
    /// 消息发送者
    pub sender: MessageSender,
    /// 消息内容
    pub content: String,
    /// 消息所在轮次
    pub round: u32,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
}

/// 消息发送者（使用 tag+content 序列化方式以区分变体）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum MessageSender {
    /// 用户
    User,
    /// Agent 实例
    Agent(InstanceId),
    /// 系统消息（如讨论开始/结束提示）
    System,
}

/// 讨论消息（Tauri command 返回类型，与 DiscussionMessageData 结构一致）
pub type DiscussionMessage = DiscussionMessageData;

/// 讨论结束摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscussionSummary {
    /// 讨论 ID
    pub discussion_id: DiscussionId,
    /// 讨论主题
    pub topic: String,
    /// 总讨论轮次
    pub total_rounds: u32,
    /// 摘要文本
    pub summary_text: String,
    /// 结束时间（Unix 时间戳 ms）
    pub ended_at: i64,
}

// ===== 通知与权限 =====

/// 通知级别枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationLevel {
    /// 信息
    Info,
    /// 警告
    Warning,
    /// 错误
    Error,
    /// 需要权限确认
    PermissionRequired,
}

/// 通知操作类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationActionType {
    /// 批准
    Approve,
    /// 拒绝
    Deny,
    /// 查看详情
    ViewDetails,
    /// 关闭
    Dismiss,
}

/// 通知操作按钮
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationAction {
    /// 按钮显示文本
    pub label: String,
    /// 操作类型
    pub action_type: NotificationActionType,
}

/// 通知项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationItem {
    /// 通知 ID
    pub id: String,
    /// 通知级别
    pub level: NotificationLevel,
    /// 来源实例 ID
    pub source_instance_id: InstanceId,
    /// 来源适配器名称
    pub source_adapter_name: String,
    /// 通知内容
    pub content: String,
    /// 可执行操作列表
    pub actions: Vec<NotificationAction>,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
    /// 是否已读
    pub read: bool,
}

/// 权限信号来源（V1-core mux 契约 §4.7）。
///
/// 可靠性排序（冻结）：**Hook（agent 结构化回调）> Scrape（刮屏正则）**——刮屏对
/// TUI 光标重绘式权限框不可靠（A.2 实机实锤），仅作无 hook agent 的降级兜底，
/// 且须显式标注其不可靠性（AttentionItem.signal_source 投影给 UI）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionSignalSource {
    /// agent 自带 hook 回调（结构化，可靠；如 Claude Code PermissionRequest hook）
    Hook,
    /// PTY 输出刮屏正则（兜底，对 TUI 重绘不可靠；serde default 兼容旧事件）
    #[default]
    Scrape,
}

/// 权限请求（附录 B3 扩展版——包含 raw_context、status、timeout_seconds）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    /// 权限请求唯一 ID
    pub id: String,
    /// 请求来源实例 ID
    pub instance_id: InstanceId,
    /// 请求的操作名称
    pub action: String,
    /// 操作说明
    pub description: String,
    /// 权限请求前后 5 行原始 PTY 输出（附录 B3）
    pub raw_context: Vec<String>,
    /// 权限状态：Pending / Approved / Denied / Expired（附录 B3）
    pub status: PermissionStatus,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
    /// 超时秒数，默认 120 秒（附录 B3）
    pub timeout_seconds: u32,
    /// 信号来源（V1-core §4.7：hook 权威 / scrape 兜底；serde default = Scrape 兼容旧事件）
    #[serde(default)]
    pub signal_source: PermissionSignalSource,
}

/// 权限决定（附录 B3——用户对权限请求的响应）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    /// 批准
    Approve,
    /// 拒绝
    Deny,
}

/// 权限状态（附录 B3——权限请求的生命周期状态）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    /// 待处理
    Pending,
    /// 已批准
    Approved,
    /// 已拒绝
    Denied,
    /// 已超时
    Expired,
}

// ===== 灵动岛 =====

/// 灵动岛模式
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IslandMode {
    /// 顶部岛模式（macOS 刘海风格）
    TopIsland,
    /// 侧边栏模式
    Sidebar,
}

// ===== 工作台布局 =====

/// 二维位置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// 二维尺寸
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

/// 单个卡片布局信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardLayout {
    /// 对应的实例 ID
    pub instance_id: InstanceId,
    /// 卡片位置
    pub position: Position,
    /// 卡片尺寸
    pub size: Size,
    /// 层叠顺序
    pub z_index: u32,
}

/// 布局模式
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayoutMode {
    /// 自由拖拽
    Free,
    /// 网格自动排列（等尺寸）
    Grid,
    /// 智能吸附排列（bin-packing，尊重各卡片不同尺寸）
    AutoPack,
}

/// 吸附排列——排序策略
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackSortStrategy {
    /// 按活跃度排序：正在 thinking/coding 的排前面、尺寸更大
    ByActivity,
    /// 按创建时间排序：先创建的在前
    ByCreatedTime,
    /// 按框架分组：同一 adapter 的卡片挨在一起
    ByFrameworkGroup,
}

/// 吸附排列——卡片尺寸策略
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardSizePreset {
    /// 智能：根据卡片状态自动分配
    ///   primary → Large, thinking/coding → Medium, idle → Small, done → Mini
    Smart,
    /// 统一：所有卡片使用相同尺寸（默认 1×1）
    Uniform,
    /// 随机：在 Mini~Large 档位间随机分配（杂志排版感），不低于 Mini
    Shuffle,
}

/// 离散卡片尺寸档位（格子单位，1 格基准 = 200×140px，gap 8px）
/// 隐形网格——不绘制可见格线，仅作为吸附对齐参考
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardSizeSlot {
    /// 最小 1×1（200×140px）— 标题 + 状态指示器可见
    Mini,
    /// 小 1×2（200×288px）
    Small,
    /// 中 2×2（408×288px）
    Medium,
    /// 大 2×3（408×436px）
    Large,
    /// 宽 3×2（616×288px）
    Wide,
}

/// AutoPack 布局配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoPackConfig {
    /// 排序策略
    pub sort_strategy: PackSortStrategy,
    /// 尺寸策略
    pub size_preset: CardSizePreset,
    /// 新增卡片时是否自动重排（否则需手动点"立即整理"）
    pub auto_repack_on_add: bool,
}

impl Default for AutoPackConfig {
    fn default() -> Self {
        Self {
            sort_strategy: PackSortStrategy::ByActivity,
            size_preset: CardSizePreset::Smart,
            auto_repack_on_add: true,
        }
    }
}

/// 画布吸附网格常量
/// snap_grid = 8px — 拖拽时位置自动对齐到 8px 整数倍，肉眼无感知
/// 与 CardSizeSlot 解耦：尺寸档位定义卡片大小，snap_grid 定义放置精度
pub const SNAP_GRID_PX: u32 = 8;

/// 工作台布局
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceLayout {
    /// 所有卡片的布局信息
    pub cards: Vec<CardLayout>,
    /// 布局模式
    pub layout_mode: LayoutMode,
    /// AutoPack 配置（仅 layout_mode == AutoPack 时生效）
    pub auto_pack_config: Option<AutoPackConfig>,
    /// 更新时间（Unix 时间戳 ms）
    pub updated_at: i64,
}

// ===== 会话记录 =====

/// 会话摘要（列表展示用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    /// 实例 ID
    pub instance_id: InstanceId,
    /// 适配器名称
    pub adapter_name: String,
    /// 工作目录
    pub working_dir: String,
    /// 开始时间（Unix 时间戳 ms）
    pub started_at: i64,
    /// 结束时间（Unix 时间戳 ms），None 表示仍在运行
    pub ended_at: Option<i64>,
    /// 事件总数
    pub event_count: u32,
}

/// 会话事件（回放用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEvent {
    /// 事件自增 ID
    pub id: i64,
    /// 实例 ID
    pub instance_id: InstanceId,
    /// 事件类型（ConfluxEvent 的 type 字段）
    pub event_type: String,
    /// JSON 序列化的事件数据
    pub data: String,
    /// 时间戳（Unix 时间戳 ms）
    pub timestamp: i64,
}

// ===== 适配器信息 =====

/// 适配器能力声明
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterCapabilities {
    /// 是否支持接收复杂调度指令（决定能否被设为灵动岛主框架）
    pub can_coordinate: bool,
    /// 针对该框架优化的调度提示词模板（仅 can_coordinate=true 时有意义）
    pub coordination_template: Option<String>,
    /// 是否支持 sub-agent 树解析
    pub can_parse_tree: bool,
    /// 是否支持权限请求检测
    pub can_detect_permission: bool,
}

/// 适配器配置（对应 TOML 文件解析结果）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterConfig {
    /// 适配器唯一名称
    pub name: String,
    /// 启动命令模板，支持 {model} 等占位符
    pub command: String,
    /// 命令默认参数
    pub default_args: Vec<String>,
    /// sandbox 模式额外参数（追加在 default_args 之后，B3.1 Contract 1）
    pub sandbox_args: Vec<String>,
    /// full 模式额外参数（追加在 default_args 之后，B3.1 Contract 1）
    pub full_args: Vec<String>,
    /// 状态检测正则模式
    pub status_patterns: StatusPatterns,
    /// 权限请求检测正则
    pub permission_pattern: Option<String>,
    /// sub-agent 生成检测正则
    pub sub_agent_spawn_pattern: Option<String>,
    /// sub-agent 完成检测正则
    pub sub_agent_complete_pattern: Option<String>,
    /// 能力声明
    pub capabilities: AdapterCapabilities,
}

/// 状态检测正则模式集合
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusPatterns {
    /// 思考中检测正则
    pub thinking: Option<String>,
    /// 编码中检测正则
    pub coding: Option<String>,
    /// 完成检测正则
    pub done: Option<String>,
    /// 错误检测正则
    pub error: Option<String>,
    /// 等待权限检测正则
    pub waiting_permission: Option<String>,
}

/// 适配器列表展示信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterInfo {
    /// 适配器 ID
    pub id: AdapterId,
    /// 适配器名称
    pub name: String,
    /// 启动命令
    pub command: String,
    /// 能力声明
    pub capabilities: AdapterCapabilities,
    /// 是否为内置适配器
    pub is_builtin: bool,
}

/// 适配器认证状态（detect_auth 结果）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterAuthStatus {
    /// 适配器 ID
    pub adapter_id: String,
    /// 是否已就绪（保持兼容；V1 中等同于 runnable）
    pub ready: bool,
    /// 状态消息（"Ready" 或具体错误说明）
    pub message: String,
    /// 登录/配置命令（如 "claude login"）
    pub login_command: Option<String>,
    /// 文档链接
    pub docs_url: Option<String>,
    /// CLI binary 是否可在当前 PATH 或显式路径中找到
    pub installed: bool,
    /// 登录/API key 是否就绪
    pub authenticated: bool,
    /// 是否允许创建真实 session
    pub runnable: bool,
    /// 是否支持 V1 session restore/playback 语义
    pub session_supported: bool,
    /// 安装状态说明
    pub install_message: Option<String>,
    /// 认证状态说明
    pub auth_message: Option<String>,
    /// 可运行状态说明
    pub runtime_message: Option<String>,
    /// session 支持说明
    pub session_message: Option<String>,
}

/// Agent 实例列表展示信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInstanceInfo {
    /// 实例 ID
    pub instance_id: InstanceId,
    /// 所属适配器 ID
    pub adapter_id: AdapterId,
    /// 适配器名称
    pub adapter_name: String,
    /// 用户自定义别名（B4: 命名后缀）
    pub display_name: Option<String>,
    /// 当前状态
    pub status: AgentStatus,
    /// 工作目录
    pub working_dir: String,
    /// 是否为钉选实例（灵动岛主框架）
    pub is_pinned: bool,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
    /// 最后活动时间（Unix 时间戳 ms）
    pub last_activity_at: i64,
    /// 结束时间（Unix 时间戳 ms）；仍在运行时为 None
    pub ended_at: Option<i64>,
    /// 运行模式（B3.1 Contract 1）
    pub mode: AgentMode,
    /// 是否为隐藏实例（讨论 sandbox 创建的，B3.1 Contract 1）
    pub hidden: bool,
}

// ===== 附录 B1: stdin 注入安全策略 =====

/// stdin 注入来源分类（附录 B1——修复 CRIT-01）。
///
/// cutover ③ D-3 裁决：与机制层统一，直接复用 conmux 类型——四变体一致、serde 同为
/// snake_case（字节级兼容，审计落库 / 事件序列化不变），消除映射函数与未来漂移。
pub use conmux::InjectionSource;

/// stdin 注入策略配置（附录 B1——修复 CRIT-01）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StdinInjectionPolicy {
    /// 自动注入（OrchestrationAuto）是否需要用户逐条确认
    /// 默认 true — 每条调度指令注入前弹出确认弹窗
    pub require_confirmation_for_auto: bool,
    /// 单次注入最大字符数限制（防止超大 payload 注入），默认 10_000
    pub max_injection_length: usize,
    /// 注入速率限制（每分钟最大注入次数，防止无限循环），默认 30
    pub rate_limit_per_minute: u32,
    /// 禁止注入的字符模式（shell 元字符等）
    pub forbidden_patterns: Vec<String>,
}

impl Default for StdinInjectionPolicy {
    fn default() -> Self {
        Self {
            require_confirmation_for_auto: true,
            max_injection_length: 10_000,
            rate_limit_per_minute: 30,
            forbidden_patterns: vec![
                "rm -rf /".to_string(),
                "rm -rf ~".to_string(),
                "mkfs".to_string(),
                "dd if=".to_string(),
                ":(){:|:&};:".to_string(), // fork bomb
                "DROP TABLE".to_string(),
                "DROP DATABASE".to_string(),
                "DELETE FROM".to_string(),
                "FORMAT C:".to_string(),
                "del /f /s /q C:\\\\".to_string(),
            ],
        }
    }
}

// ===== 附录 B4: 事件优先级 =====

/// 事件优先级（附录 B4——修复 HIGH-02/03）
/// 用于事件总线的双通道分发和 SQLite 写入策略
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum EventPriority {
    /// 最高：权限请求、CRITICAL 错误
    Critical = 0,
    /// 高：状态变更、讨论消息
    High = 1,
    /// 普通：sub-agent 事件、任务完成
    Normal = 2,
    /// 低：PTY 原始输出
    Low = 3,
}

// ===== 错误严重级别（ConfluxEvent::ErrorOccurred 使用） =====

/// 错误严重级别
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorSeverity {
    /// 警告
    Warning,
    /// 错误
    Error,
    /// 致命错误
    Fatal,
}

// ===== 控制面语义层 P1: 事件来源分类 =====

/// 持久化事件的来源通道（F1 控制面契约 §2.1 / §5.4）
///
/// 标注 `session_events.source_kind`，区分 hook / PTY / runtime / 用户动作 / 系统。
/// V1 不强制接 Claude Code hooks，但 `Hook` 通道先留好。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    /// 来自 CLI hook（Claude Code/Codex hooks，V1 预留）
    Hook,
    /// 来自 PTY 输出解析
    Pty,
    /// 来自运行时（进程生命周期、状态机）
    Runtime,
    /// 来自用户动作（UI 触发）
    UserAction,
    /// 来自系统内部（编排、讨论引擎等）
    System,
}
