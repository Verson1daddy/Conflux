// ===== jsonl.ts 单测（M⑥ §5/§7 闸2，移植 claude.test.ts vitest 风格）=====
//
// 覆盖契约要求：真实 usage 累加/ctx、synthetic 跳过保留、全零跳过、windowForModel
// 各前缀+未知 null、Workflow→activeWorkflow + tool_result 清除、Skill→recentSkill、
// 坏行容错、parseWorkflowName 单引号匹配。
//
// ground truth（2026-06-15 ~/.claude/projects/<sanitized>/*.jsonl）：assistant.message
// .model（"claude-opus-4-8" / "<synthetic>"）+ .usage（input/output/cache_read/
// cache_creation_input_tokens）；content tool_use（id=toolu_… / call_…）；user content
// tool_result（tool_use_id）。只测纯函数解析，不接文件系统。

import { describe, expect, it } from "vitest";
import {
  contextTokensFromUsage,
  initJsonlAccum,
  isClaudeModel,
  parseJsonlLines,
  parseWorkflowName,
  windowForModel,
} from "./jsonl";

/** 构造一条 assistant JSONL 行。 */
function asst(opts: {
  model: string;
  usage?: Record<string, number>;
  content?: unknown[];
}): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      model: opts.model,
      usage: opts.usage ?? {},
      content: opts.content ?? [],
    },
  });
}

/** 构造一条 user JSONL 行（携带 tool_result）。 */
function userToolResult(toolUseId: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }],
    },
  });
}

const REAL_USAGE = {
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_input_tokens: 2000,
  cache_creation_input_tokens: 3000,
};

describe("windowForModel", () => {
  it("maps real opus/sonnet/fable ID prefixes to 1M", () => {
    expect(windowForModel("claude-opus-4-8")).toBe(1_000_000);
    expect(windowForModel("claude-sonnet-4-5")).toBe(1_000_000);
    expect(windowForModel("claude-fable-5")).toBe(1_000_000);
    expect(windowForModel("claude-fable-5-mini")).toBe(1_000_000);
  });

  it("maps haiku ID prefix to 200k", () => {
    expect(windowForModel("claude-haiku-4-5")).toBe(200_000);
  });

  it("maps short family names (opus/sonnet/fable → 1M, haiku → 200k)", () => {
    expect(windowForModel("Opus 4.8 (1M context)")).toBe(1_000_000);
    expect(windowForModel("Sonnet")).toBe(1_000_000);
    expect(windowForModel("haiku")).toBe(200_000);
  });

  it("returns null for synthetic / unknown / nullish (never guesses)", () => {
    expect(windowForModel("<synthetic>")).toBeNull();
    expect(windowForModel("gpt-4o")).toBeNull();
    expect(windowForModel("some-future-model")).toBeNull();
    expect(windowForModel(null)).toBeNull();
    expect(windowForModel(undefined)).toBeNull();
    expect(windowForModel("")).toBeNull();
  });
});

describe("isClaudeModel (JSONL 自检激活 D-10)", () => {
  it("true for claude-family ids + short names, false for synthetic/unknown/nullish", () => {
    expect(isClaudeModel("claude-opus-4-8")).toBe(true);
    expect(isClaudeModel("claude-haiku-4-5")).toBe(true);
    expect(isClaudeModel("Opus 4.8 (1M context)")).toBe(true);
    expect(isClaudeModel("<synthetic>")).toBe(false);
    expect(isClaudeModel("gpt-4o")).toBe(false);
    expect(isClaudeModel(null)).toBe(false);
    expect(isClaudeModel(undefined)).toBe(false);
  });
});

describe("contextTokensFromUsage", () => {
  it("sums input + cache_read + cache_creation (excludes output)", () => {
    // 1000 + 2000 + 3000 = 6000（output 500 不计入 ctx 分子）。
    expect(contextTokensFromUsage(REAL_USAGE)).toBe(6000);
  });
  it("tolerates missing fields / nullish (0)", () => {
    expect(contextTokensFromUsage({ input_tokens: 100 })).toBe(100);
    expect(contextTokensFromUsage(null)).toBe(0);
    expect(contextTokensFromUsage(undefined)).toBe(0);
  });
});

describe("parseWorkflowName", () => {
  it("matches single-quoted meta name", () => {
    expect(
      parseWorkflowName("# header\nmeta:\n  name: 'conmux-m6-implement'\n")
    ).toBe("conmux-m6-implement");
  });
  it("matches double-quoted meta name", () => {
    expect(parseWorkflowName('name: "my-workflow"')).toBe("my-workflow");
  });
  it("returns null when no name: (short scriptPath)", () => {
    expect(parseWorkflowName("D:/path/to/workflow.md")).toBeNull();
    expect(parseWorkflowName(null)).toBeNull();
    expect(parseWorkflowName(undefined)).toBeNull();
  });
});

describe("parseJsonlLines — token/ctx/model (M-1)", () => {
  it("accumulates real assistant usage and computes ctx/contextPct/model", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [asst({ model: "claude-opus-4-8", usage: REAL_USAGE })],
      accum
    );
    expect(patch.model).toBe("claude-opus-4-8");
    expect(patch.tokensUsed).toBe(6000); // 1000+2000+3000
    expect(patch.tokensTotal).toBe(1_000_000);
    expect(patch.contextPct).toBe(1); // round(6000/1e6*100) = 1
    expect(patch.sessionTokensIn).toBe(6000);
    expect(patch.sessionTokensOut).toBe(500);
  });

  it("ctx reflects LAST real message; Σ accumulates across messages", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [
        asst({ model: "claude-opus-4-8", usage: REAL_USAGE }), // ctx 6000, out 500
        asst({
          model: "claude-opus-4-8",
          usage: { input_tokens: 10, output_tokens: 20 },
        }), // ctx 10, out 20
      ],
      accum
    );
    expect(patch.tokensUsed).toBe(10); // 最后真实消息的 ctx
    expect(patch.sessionTokensIn).toBe(6010); // 6000 + 10
    expect(patch.sessionTokensOut).toBe(520); // 500 + 20
  });

  it("skips <synthetic> messages, preserving the previous real value", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [
        asst({ model: "claude-opus-4-8", usage: REAL_USAGE }), // 真实 → ctx 6000
        asst({
          model: "<synthetic>",
          usage: { input_tokens: 0, output_tokens: 0 },
        }), // synthetic → 跳过
      ],
      accum
    );
    expect(patch.model).toBe("claude-opus-4-8"); // 保留上一真值（非 synthetic）
    expect(patch.tokensUsed).toBe(6000); // 保留，不被 synthetic 打成假 0
    expect(patch.sessionTokensOut).toBe(500); // synthetic 不累加
  });

  it("skips all-zero usage messages (防假 0)", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        }),
      ],
      accum
    );
    // 全零 usage 跳过 → 无真实消息 → ctx 字段保持 null（patch 不写）。
    expect(patch.tokensUsed).toBeUndefined();
    expect(patch.contextPct).toBeUndefined();
    expect(patch.model).toBeUndefined();
  });

  it("contextPct is null when window unknown (unknown model, never guesses)", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [asst({ model: "gpt-4o", usage: REAL_USAGE })],
      accum
    );
    expect(patch.tokensUsed).toBe(6000);
    expect(patch.tokensTotal).toBeNull(); // 未知 model → window null
    expect(patch.contextPct).toBeNull(); // 不猜
    expect(patch.model).toBe("gpt-4o");
  });

  it("keeps ctx null before any real message appears (honest —)", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [asst({ model: "<synthetic>", usage: {} })],
      accum
    );
    expect(patch.tokensUsed).toBeUndefined();
    expect(patch.contextPct).toBeUndefined();
  });
});

describe("parseJsonlLines — Workflow / Skill (S-2/D-12)", () => {
  it("tracks activeWorkflow by block.id and clears on tool_result", () => {
    const accum = initJsonlAccum();
    const script = "meta:\n  name: 'conmux-m6-implement'\n# body";
    // Workflow 派发（toolu_ 前缀）。
    let r = parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          usage: REAL_USAGE,
          content: [
            { type: "tool_use", id: "toolu_abc", name: "Workflow", input: { script } },
          ],
        }),
      ],
      accum
    );
    expect(r.patch.activeWorkflow).toBe("conmux-m6-implement");
    // tool_result 完成 → 清空。
    r = parseJsonlLines([userToolResult("toolu_abc")], accum);
    expect(r.patch.activeWorkflow).toBeNull();
  });

  it("matches call_ prefixed ids literally (not just toolu_)", () => {
    const accum = initJsonlAccum();
    let r = parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          usage: REAL_USAGE,
          content: [
            {
              type: "tool_use",
              id: "call_xyz",
              name: "Workflow",
              input: { script: "name: \"wf-b\"" },
            },
          ],
        }),
      ],
      accum
    );
    expect(r.patch.activeWorkflow).toBe("wf-b");
    r = parseJsonlLines([userToolResult("call_xyz")], accum);
    expect(r.patch.activeWorkflow).toBeNull();
  });

  it("falls back to 'workflow' when script has no parseable name", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          usage: REAL_USAGE,
          content: [
            {
              type: "tool_use",
              id: "toolu_p",
              name: "Workflow",
              input: { scriptPath: "D:/wf.md" },
            },
          ],
        }),
      ],
      accum
    );
    expect(patch.activeWorkflow).toBe("workflow");
  });

  it("records recentSkill from Skill tool_use input.skill", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          usage: REAL_USAGE,
          content: [
            { type: "tool_use", id: "toolu_s", name: "Skill", input: { skill: "deep-research" } },
          ],
        }),
      ],
      accum
    );
    expect(patch.recentSkill).toBe("deep-research");
  });

  it("keeps latest active workflow when two overlap; clearing one leaves the other", () => {
    const accum = initJsonlAccum();
    parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          usage: REAL_USAGE,
          content: [
            { type: "tool_use", id: "toolu_1", name: "Workflow", input: { script: "name: 'wf-1'" } },
            { type: "tool_use", id: "call_2", name: "Workflow", input: { script: "name: 'wf-2'" } },
          ],
        }),
      ],
      accum
    );
    // 清除最近一个（wf-2）→ 剩 wf-1 仍 active。
    const r = parseJsonlLines([userToolResult("call_2")], accum);
    expect(r.patch.activeWorkflow).toBe("wf-1");
  });
});

describe("parseJsonlLines — robustness (L-3)", () => {
  it("skips bad / half lines without throwing", () => {
    const accum = initJsonlAccum();
    const lines = [
      "{ not valid json",
      '{"type":"assistant","message":', // 半行
      "",
      asst({ model: "claude-opus-4-8", usage: REAL_USAGE }), // 一条好行
    ];
    const { patch } = parseJsonlLines(lines, accum);
    expect(patch.tokensUsed).toBe(6000); // 好行仍被解析
  });

  it("tolerates records without message / with non-array content", () => {
    const accum = initJsonlAccum();
    const lines = [
      JSON.stringify({ type: "attachment" }),
      JSON.stringify({ type: "assistant", message: { model: "x", content: "str" } }),
      JSON.stringify({ type: "user", message: { content: null } }),
    ];
    const { patch } = parseJsonlLines(lines, accum);
    expect(patch.activeWorkflow).toBeNull();
    expect(patch.recentSkill).toBeNull();
    expect(patch.tokensUsed).toBeUndefined();
  });
});

// ===== 子 agent 派发跟踪（P0-1，ground truth 2026-07-02 本机 jsonl 实测）=====
// 派发 = tool_use name:"Agent"（旧版名 "Task" 兼容），input.subagent_type/description；
// tool_result 指回 = done（粘性，节点保留——区别于 activeWf 完成即删）。
describe("parseJsonlLines · subagents (P0-1)", () => {
  function dispatch(opts: {
    id: string;
    name?: string;
    subagent_type?: string;
    description?: string;
  }): unknown {
    const input: Record<string, unknown> = { prompt: "…" };
    if (opts.subagent_type !== undefined) input.subagent_type = opts.subagent_type;
    if (opts.description !== undefined) input.description = opts.description;
    return { type: "tool_use", id: opts.id, name: opts.name ?? "Agent", input };
  }

  it("Agent tool_use 派发 → running 节点（type/description 取 input 真值）", () => {
    const { patch } = parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          content: [
            dispatch({ id: "toolu_a", subagent_type: "Explore", description: "Scan files" }),
          ],
        }),
      ],
      initJsonlAccum(),
    );
    expect(patch.subagents).toEqual([
      { type: "Explore", description: "Scan files", status: "running", detail: null },
    ]);
  });

  it("旧版名 Task 兼容收", () => {
    const { patch } = parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          content: [
            dispatch({ id: "toolu_t", name: "Task", subagent_type: "Plan", description: "Plan it" }),
          ],
        }),
      ],
      initJsonlAccum(),
    );
    expect(patch.subagents?.[0]).toMatchObject({ type: "Plan", status: "running" });
  });

  it("tool_result 指回 → done 粘性且节点保留", () => {
    const accum = initJsonlAccum();
    parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          content: [dispatch({ id: "toolu_d", subagent_type: "Explore", description: "x" })],
        }),
      ],
      accum,
    );
    const { patch } = parseJsonlLines([userToolResult("toolu_d")], accum);
    expect(patch.subagents).toHaveLength(1);
    expect(patch.subagents?.[0]).toMatchObject({ status: "done", detail: null });
  });

  it("省略 subagent_type / description → 中性 'agent' + 空描述（不臆造）", () => {
    const { patch } = parseJsonlLines(
      [asst({ model: "claude-opus-4-8", content: [dispatch({ id: "toolu_n" })] })],
      initJsonlAccum(),
    );
    expect(patch.subagents?.[0]).toMatchObject({
      type: "agent",
      description: "",
      status: "running",
    });
  });

  it("未观测到派发 → patch 不写 subagents（防把 PTY 累计项误标 historic）", () => {
    const { patch } = parseJsonlLines(
      [asst({ model: "claude-opus-4-8", usage: REAL_USAGE })],
      initJsonlAccum(),
    );
    expect(patch.subagents).toBeUndefined();
  });

  it("同 id 重复不重计；多派发保持首次观测序", () => {
    const accum = initJsonlAccum();
    const { patch } = parseJsonlLines(
      [
        asst({
          model: "claude-opus-4-8",
          content: [
            dispatch({ id: "toolu_1", subagent_type: "Explore", description: "one" }),
            dispatch({ id: "toolu_1", subagent_type: "Explore", description: "one" }),
            dispatch({ id: "toolu_2", subagent_type: "Plan", description: "two" }),
          ],
        }),
      ],
      accum,
    );
    expect(patch.subagents?.map((n) => n.description)).toEqual(["one", "two"]);
  });
});
