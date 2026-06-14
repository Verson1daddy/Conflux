// ===== parser registry（M3-ext F1 契约 §1）=====
//
// 默认 shell；内容嗅探到 agent banner 时升级到对应 parser。
// graceful degradation：无任何 agent parser 命中 → 维持 shell（诚实兜底）。
//
// 升级是单向且粘性的：一旦嗅探到 claude（或其它 agent），后续保持该 parser，
// 不会因短暂无 banner 又回落 shell（避免 B6 行抖动；agent 进程仍在跑的诚实判断）。
// 进程退出（observer 收 onPtyExit）后由 observer 重置回 shell。

import type { AgentParser } from "./parsers/types";
import { shellParser } from "./parsers/shell";
import { claudeParser } from "./parsers/claude";

/** 可嗅探升级的 agent parser 列表（按优先级；shell 不在内，是兜底默认）。 */
const AGENT_PARSERS: AgentParser[] = [claudeParser];

export class ParserRegistry {
  private current: AgentParser = shellParser;

  /** 当前生效的 parser。 */
  get active(): AgentParser {
    return this.current;
  }

  /**
   * 依据最近输出尝试升级 parser（单向粘性）。
   * @returns 本次是否发生了升级（用于 observer 决定是否标记 isAgent 变更）。
   */
  maybeUpgrade(recentOutput: string): boolean {
    // 已升级到某 agent parser → 保持，不重复嗅探（粘性）。
    if (this.current.id !== shellParser.id) return false;
    for (const p of AGENT_PARSERS) {
      if (p.sniff(recentOutput)) {
        this.current = p;
        return true;
      }
    }
    return false;
  }

  /** 重置回 shell 默认（进程退出 / 重新观测时）。 */
  reset(): void {
    this.current = shellParser;
  }
}
