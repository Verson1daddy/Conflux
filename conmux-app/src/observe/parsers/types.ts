// ===== 可插拔 agent parser 接口（M3-ext F1 契约 §1）=====
//
// registry 持一组 parser；默认 shell，内容嗅探到 agent banner 时升级到对应 parser
// （graceful degradation：无匹配 = 回落 shell）。
//
// 铁律（§0）：parser 只从**真打印**到 PTY 的内容提取字段；拿不到一律返回 undefined /
// 不在 patch 里出现该 key（→ 上游保持 null → UI 显 `—`）。**不猜、不编**。

import type { AwareState } from "../types";

/** parser 增量解析返回的状态片（只含本块能诚实确定的字段）。 */
export type AwareStatePatch = Partial<
  Pick<
    AwareState,
    | "activity"
    | "model"
    | "tokensUsed"
    | "tokensTotal"
    | "contextPct"
    // M3-ext-2：放行 subagents 维度的唯一改动点（session-observer 泛型 merge
    // 自动传播，observer 零改）。parser 写空/非空数组皆可（[] = 当前无）。
    | "subagents"
  >
>;

export interface AgentParser {
  /** parser 标识（'shell' | 'claude' | ...）。 */
  id: string;
  /** 命中此 parser 是否代表「这是个 agent 会话」（驱动 B6 行显隐）。 */
  isAgent: boolean;
  /**
   * 嗅探：依据最近输出判断本 parser 是否应接管。
   * shell 兜底恒 false；agent parser 检测自身 banner 特征。
   */
  sniff(recentOutput: string): boolean;
  /**
   * 增量解析当前输出块，返回可诚实确定的状态片。
   * @param chunk     本次新到的解码文本块
   * @param recentRaw observer 维护的最近原始输出缓冲（供需要跨块上下文的提取）
   * @returns 只含本块能确定的字段；拿不到的字段不出现（保持 null）。
   */
  parse(chunk: string, recentRaw: string): AwareStatePatch;
}
