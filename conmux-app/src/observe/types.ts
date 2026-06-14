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
   * cost：v1 恒 null（→ UI 显 `—`）。
   * 终端不打印、无 provider API/凭据；不接、不算、不编（§0 铁律）。
   */
  cost: null;
  /** 是否已嗅探升级到非 shell 的 agent parser（驱动 B6 行显隐 / 淡化）。 */
  isAgent: boolean;
  /** 当前生效的 parser id（'shell' | 'claude' | ...）。 */
  parserId: string;
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
    isAgent: false,
    parserId: "shell",
  };
}
