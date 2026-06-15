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
//   cost     ← 无来源（需 provider 凭据 / API）→ v1 恒 null（UI 显 `—`，不接、不算、不编）

/** pane 生命周期 / 活跃度态（状态点语义）。 */
export type ObserveStatus = "running" | "idle" | "exited";

/**
 * 观测到的子 agent 节点（M3-ext-2 F1 §1，深 agent 观测 v2）。
 *
 * 诚实铁律（§0）：每个节点必须能在 strippedBuffer 16KB 窗口里找到对应派发行
 * （`● <type>(<description>)`）；窗口外滚走的不补、不造。status 取折叠行字面，
 * 解析不到 → 缺省 "running" + detail=null（在跑但状态未知，绝不编造）。
 * claude 渲 main→subagents **一层** → 扁平数组（不臆造更深嵌套）。
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
   * cost：M⑥ 砍（订阅边际≈$0，显金额误导）。类型保留 `null` 减小 diff，
   * AwareHeader B6 已移除 cost slot 渲染（D-4）。
   */
  cost: null;
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
   * 观测到的子 agent（M3-ext-2 §1）。`[]` = 当前无可观测子 agent（诚实空，UI 不渲染树）。
   * 只含 strippedBuffer 窗口内真实出现的派发行；shell 态恒 `[]`（无 subagent）。
   */
  subagents: SubagentNode[];
}

/** 观测起始的初始状态（全 null / running / 0ms，诚实空态）。 */
export function initialAwareState(): AwareState {
  return {
    status: "running",
    activity: null,
    elapsedMs: 0,
    cwd: null,
    model: null,
    tokensUsed: null,
    tokensTotal: null,
    contextPct: null,
    cost: null,
    sessionTokensIn: null,
    sessionTokensOut: null,
    activeWorkflow: null,
    recentSkill: null,
    isAgent: false,
    parserId: "shell",
    subagents: [],
  };
}
