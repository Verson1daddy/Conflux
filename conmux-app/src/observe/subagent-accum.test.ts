// ===== accumulateSubagents 单测（subagent 持久化 2026-06-19）=====
//
// 验证会话级累计的诚实口径：留存真观测、done 粘性、派发序、滚出标 historic、重现转 live。

import { describe, expect, it } from "vitest";
import { accumulateSubagents } from "./subagent-accum";
import type { SubagentNode } from "./types";

const node = (
  type: string,
  description: string,
  status: SubagentNode["status"] = "running",
  detail: string | null = null,
  historic?: boolean
): SubagentNode => ({
  type,
  description,
  status,
  detail,
  ...(historic !== undefined ? { historic } : {}),
});

describe("accumulateSubagents", () => {
  it("新观测项以 historic:false 按派发序加入", () => {
    const r = accumulateSubagents([], [node("Explore", "a"), node("Plan", "b")]);
    expect(r.map((n) => [n.type, n.historic])).toEqual([
      ["Explore", false],
      ["Plan", false],
    ]);
  });

  it("滚出窗口（不在 incoming）→ 留存 + 标 historic", () => {
    const prev = accumulateSubagents([], [node("Explore", "a")]);
    const r = accumulateSubagents(prev, []); // 本轮窗口无可见 subagent
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("Explore");
    expect(r[0].historic).toBe(true);
  });

  it("done 粘性：running → 观测到 done 即 done，detail 取完成行", () => {
    const prev = accumulateSubagents([], [node("Explore", "a", "running")]);
    const r = accumulateSubagents(
      prev,
      [node("Explore", "a", "done", "Done (1 tool use · 16s)")]
    );
    expect(r[0].status).toBe("done");
    expect(r[0].detail).toBe("Done (1 tool use · 16s)");
    expect(r[0].historic).toBe(false);
  });

  it("done 不被随后的 running 回退（终态粘性）", () => {
    const prev = accumulateSubagents(
      [],
      [node("Explore", "a", "done", "Done (x)")]
    );
    const r = accumulateSubagents(prev, [node("Explore", "a", "running")]);
    expect(r[0].status).toBe("done");
    expect(r[0].detail).toBe("Done (x)"); // 完成 detail 不被运行态的 null 抹掉
  });

  it("已滚出项重新出现在窗口 → 转回 live（historic:false）", () => {
    const prev = accumulateSubagents(
      [node("Explore", "a", "running", null, true)],
      []
    );
    expect(prev[0].historic).toBe(true);
    const r = accumulateSubagents(prev, [node("Explore", "a", "running")]);
    expect(r[0].historic).toBe(false);
  });

  it("保留派发序：旧项在前（标 historic），本轮新项追加在后", () => {
    let acc = accumulateSubagents([], [node("Explore", "a"), node("Plan", "b")]);
    acc = accumulateSubagents(acc, [node("general-purpose", "c")]);
    expect(acc.map((n) => n.type)).toEqual(["Explore", "Plan", "general-purpose"]);
    expect(acc.map((n) => n.historic)).toEqual([true, true, false]);
  });

  it("不修改输入数组（不可变）", () => {
    const prev = [node("Explore", "a")];
    const r = accumulateSubagents(prev, [node("Plan", "b")]);
    expect(prev).toHaveLength(1);
    expect(r).toHaveLength(2);
  });

  it("type 同名但 description 不同 → 视为不同节点", () => {
    const r = accumulateSubagents(
      [],
      [node("Explore", "a"), node("Explore", "b")]
    );
    expect(r).toHaveLength(2);
  });
});
