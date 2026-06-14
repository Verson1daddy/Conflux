// ===== shell parser（默认 / 兜底，M3-ext F1 契约 §1）=====
//
// 非 agent 终端会话的诚实最小观测：只判活跃度（running / idle 由 observer 计），
// 不提取任何 LLM 元数据，不编具体活动。
//
// 诚实策略（§2）：
//   activity → null（不编「shell 在做什么」；observer 据 status 泛化为「运行中/空闲」）
//   model / tokens / contextPct → 不提供（保持 null → UI 显 `—` / B6 整行淡化）
//
// sniff 恒 false：shell 是 registry 的兜底默认，不靠嗅探命中，而是「无其它 parser
// 匹配时」由 registry 回落到它。

import type { AgentParser } from "./types";

export const shellParser: AgentParser = {
  id: "shell",
  isAgent: false,
  // 默认兜底，不主动嗅探升级（registry 在无匹配时回落到本 parser）。
  sniff(): boolean {
    return false;
  },
  // shell 态不解析任何 LLM 元数据；活跃度由 observer 统一计算。
  // 返回空 patch：保持上游 state 不变（不编 activity / model / tokens）。
  parse(): Record<string, never> {
    return {};
  },
};
