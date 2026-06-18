// ===== subagent 累计合并（持久化，2026-06-19）=====
//
// 把「每轮窗口解析出的 subagents」合进「会话级累计列表」的纯函数（observer 调用，
// 易测）。诚实口径（见 memory_bank/decisions.md D-M3-003）：
//   - 只累计真观测到的派发行（incoming 来自 claude.ts extractSubagents 的窗口解析）；
//     从不臆造未观测节点。
//   - done 粘性：一旦观测到完成（done）就永远 done（完成是终态）。
//   - 按派发序（首次观测顺序）：prev 在前，新观测的 key 追加在后。
//   - provenance：不在本轮 incoming（已滚出窗口）的累计项标 historic=true（status 为
//     末次观测值，非实时）；在 incoming 内的标 historic=false（实时）。

import type { SubagentNode } from "./types";

/**
 * 去重键：type + NUL + description。NUL 用转义 `\x00`（源码是文本、运行时才是 NUL，
 * 避免 git 判 binary——控制字符教训）；NUL 不会出现在 type/description 故不会误并。
 */
function keyOf(n: SubagentNode): string {
  return `${n.type}\x00${n.description}`;
}

/**
 * 把本轮窗口 incoming 合进累计 prev，返回新的累计数组（不可变；prev 不被修改）。
 *   - incoming 内的项 → upsert 为 historic:false（实时）；done 粘性、done detail 优先。
 *   - prev 有而 incoming 无的项 → 标 historic:true（已滚出窗口，末次观测值）。
 *   - 顺序：prev 原序在前，incoming 中的新 key 追加在后（首次观测序）。
 */
export function accumulateSubagents(
  prev: SubagentNode[],
  incoming: SubagentNode[]
): SubagentNode[] {
  const incomingKeys = new Set(incoming.map(keyOf));
  // Map 以 prev 原序初始化（保留派发序）；upsert 同 key 原位更新、新 key 追加。
  const byKey = new Map<string, SubagentNode>();
  for (const n of prev) byKey.set(keyOf(n), n);

  for (const node of incoming) {
    const k = keyOf(node);
    const ex = byKey.get(k);
    if (!ex) {
      byKey.set(k, { ...node, historic: false });
      continue;
    }
    // done 粘性；detail 取完成行（更具体），运行态新值无 detail 时保留旧值。
    const status: SubagentNode["status"] =
      ex.status === "done" || node.status === "done" ? "done" : node.status;
    const detail =
      node.status === "done" ? node.detail : node.detail ?? ex.detail;
    byKey.set(k, { ...node, status, detail, historic: false });
  }

  // 不在本轮窗口的累计项 → 标 historic（末次观测，非实时）。
  for (const [k, n] of byKey) {
    if (!incomingKeys.has(k) && n.historic !== true) {
      byKey.set(k, { ...n, historic: true });
    }
  }

  return Array.from(byKey.values());
}
