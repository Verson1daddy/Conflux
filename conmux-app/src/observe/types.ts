// ===== aware-header 观测状态（M3-ext F1 契约 §1）=====
//
// 铁律（§0）：诚实观测，绝不臆造。每个字段要么来自可验证来源（计算 / spawn 已知 /
// 从 PTY 输出真解析到），要么为 null（UI 显 `—`）。禁止为好看填假数。
//
// 字段来源（§2 诚实表）：
//   status   ← 输出活跃度（最近 N s 有输出 = running；超时 = idle；onPtyExit = exited）
//   activity ← agent 工具标记解析；解析不到 = null（UI 泛化「运行中 / 空闲」，不编具体活动）
//   elapsedMs← 计算（观测起始 / 首帧起）；恒诚实
//   cwd      ← spawn 已知（本 demo spawn cwd=None → 初始 null）+ OSC7 实时；无则 null
//   model    ← agent banner 解析；解析不到 = null
//   tokens*  ← agent 真打印才解析；多数 claude 版本不打印 → 大概率 null（可接受）
//   contextPct← 同 tokens（真打印才解析）
//   （费用 / $ 成本：用户决策**永久不做**——订阅边际≈$0，显金额误导。字段已删，勿再加回。）

/** pane 生命周期 / 活跃度态（状态点语义）。 */
export type ObserveStatus = "running" | "idle" | "exited";

/**
 * 观测到的子 agent 节点（M3-ext-2 F1 §1，深 agent 观测 v2）。
 *
 * 诚实铁律（§0）：每个节点必须**曾在** strippedBuffer 窗口里真出现过对应派发行
 * （`● <type>(<description>)`）；从不臆造未观测的节点。status 取折叠行字面，
 * 解析不到 → 缺省 "running" + detail=null（在跑但状态未知，绝不编造）。
 * claude 渲 main→subagents **一层** → 扁平数组（不臆造更深嵌套）。
 *
 * §0 扩展（subagent 持久化，2026-06-19，见 memory_bank/decisions.md）：节点由「仅当前
 * 窗口」升级为「会话级累计派发历史」——一旦真观测到即留存、滚出窗口不丢。但**诚实标 provenance**：
 * `historic=true` = 已滚出当前窗口（status 为末次观测值）；UI 据此降透明 + 去 live 脉冲，
 * 绝不让已滚出的 running 项谎称仍在 live 跳动。仍从不臆造未观测节点。
 */
export interface SubagentNode {
  /** agent 类型（派发行 `● Type(` 的 Type）：Explore / Plan / general-purpose / 自定义。 */
  type: string;
  /** 描述（派发行括号内文本，e.g. "List files in current folder"）。 */
  description: string;
  /** running = 派发中/状态未知；done = 折叠行含 Done。 */
  status: "running" | "done";
  /** done 折叠行原文（e.g. "Done (1 tool use · 18.9k tokens · 16s)"）；解析不到 = null。 */
  detail: string | null;
  /**
   * true = 该节点已滚出当前观测窗口（status/detail 为末次观测值，非实时）。
   * 累计历史里的"过去时"标记；UI 降透明 + 去脉冲。缺省 / false = 仍在当前窗口（实时）。
   */
  historic?: boolean;
}

/**
 * aware-header 可诚实观测的会话运行状态。
 * null 字段一律由 UI 渲染为 `—`（诚实「拿不到」），绝不用占位假数填充。
 */
export interface AwareState {
  /** running = 最近活跃；idle = 静默超时；exited = onPtyExit 已触发。 */
  status: ObserveStatus;
  /** 具体活动（如 agent 工具标记）；解析不到 = null（UI 泛化）。 */
  activity: string | null;
  /** 观测起始至今的耗时（ms）；计算所得，恒诚实。 */
  elapsedMs: number;
  /** 工作目录（OSC7 实时解析 / spawn 已知）；无则 null。 */
  cwd: string | null;
  /** 模型名（agent banner 解析）；解析不到 = null。 */
  model: string | null;
  /** 已用 token（agent 真打印才解析）；否则 null。 */
  tokensUsed: number | null;
  /** token 上限 / 总额（agent 真打印才解析）；否则 null。 */
  tokensTotal: number | null;
  /** 上下文占用百分比（agent 真打印才解析）；否则 null。 */
  contextPct: number | null;
  /**
   * 本会话累计输入处理 tokens（Σ over 真实 assistant 消息的 input + cache_read +
   * cache_creation）。来源 = Claude Code 会话 JSONL（M⑥ §3）；无真实消息 → null。
   */
  sessionTokensIn: number | null;
  /** 本会话累计生成 tokens（Σ output_tokens）。来源同上；无真实消息 → null。 */
  sessionTokensOut: number | null;
  /**
   * 正在跑的 workflow meta.name（JSONL Workflow tool 跟踪到完成前 active；
   * 解析不到名但在跑 → "workflow" 兜底；完成清空）。无 → null（M⑥ §3/D-12）。
   */
  activeWorkflow: string | null;
  /**
   * 最近一次 Skill tool_use 的 input.skill（标"最近调用"，非伪 live——skill 同步加载、
   * 非长跑进程）。来源 = JSONL（M⑥ §3/D-6）；无 → null。
   */
  recentSkill: string | null;
  /** 是否已嗅探升级到非 shell 的 agent parser（驱动 B6 行显隐 / 淡化）。 */
  isAgent: boolean;
  /** 当前生效的 parser id（'shell' | 'claude' | ...）。 */
  parserId: string;
  /**
   * 观测到的子 agent（M3-ext-2 §1 + 持久化扩展）。`[]` = 本会话从未观测到子 agent
   * （诚实空，UI 不渲染树）。**会话级累计**：一旦真观测到即留存（按派发序、done 粘性），
   * 滚出窗口的标 `historic`（末次观测值）。shell 态恒 `[]`（无 subagent）。
   */
  subagents: SubagentNode[];
  /**
   * 需注意（attention 真路由 MF-3，2026-06-19）：由**真 PTY 信号**置真——
   * 终端响铃（BEL `\x07`）或进程退出。非启发式臆测。App 据此 + 非活跃 → 缩点 attention 脉冲；
   * 用户切到该会话即 acknowledge 清除（你看了就不再"需注意"）。
   */
  attention: boolean;
  /**
   * P1-a（2026-07-02 审计）：claude 启动意图会话的 JSONL 富观测因 **cwd 未知**被阻断
   * （observer 无法定位会话文件）。此前是静默失效（字段恒「—」，用户不知何故）——
   * 现在显式置真，UI 渲染诚实提示；cwd 后到（OSC7 / 用户配置）即清。
   * 非 claude 会话恒 false。
   */
  jsonlBlockedNoCwd: boolean;
  /**
   * G1（2026-07-03）：该会话的 Notification hook relay 是否已产出过 ≥1 条事件。
   * true = hook 链路**已确证**在工作（relay 真写过文件）——诚实标注已确证的深度
   * 感知能力，**非承诺**：false 不代表 hook 不工作，可能只是还没触发权限框/空闲
   * 提问。故只正向标注（确证才亮），不据 false 断言"未激活"。非 claude / 未注入
   * hook 的会话恒 false。
   */
  hookObserved: boolean;
}

/** 观测起始的初始状态（全 null / running / 0ms，诚实空态）。 */
export function initialAwareState(): AwareState {
  return {
    status: "running",
    attention: false,
    jsonlBlockedNoCwd: false,
    hookObserved: false,
    activity: null,
    elapsedMs: 0,
    cwd: null,
    model: null,
    tokensUsed: null,
    tokensTotal: null,
    contextPct: null,
    sessionTokensIn: null,
    sessionTokensOut: null,
    activeWorkflow: null,
    recentSkill: null,
    isAgent: false,
    parserId: "shell",
    subagents: [],
  };
}
