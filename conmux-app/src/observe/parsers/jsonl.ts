// ===== Claude Code 会话 JSONL 解析（M⑥ F1 契约 §5，深 agent 观测 v3）=====
//
// 后端 `read_claude_jsonl` 只做 IO（读会话 JSONL 尾部增量返原文行）；解析 / 累加 /
// 识别全在此纯函数里（D-1），可单测、符合项目测试哲学。
//
// 诚实铁律（§1）：每个非「—」字段必须能在真实 JSONL 找到（CLI 自己写的真 usage /
// 模型字面 / 真实工具调用）。**绝不猜、绝不编**（红队重点核）。坏行 / 半行 try/catch
// 跳过——**绝不把行内容打进 console / 日志**（含对话明文，L-3 隐私）。
//
// JSONL 结构（2026-06-15 ground truth，~/.claude/projects/<sanitized>/*.jsonl）：
//   - 每行一条 JSON 记录，顶层 `type`（assistant / user / attachment / ...）+ 顶层 `cwd`。
//   - assistant 行：`message.model`（"claude-opus-4-8" / "<synthetic>"）+ `message.usage`
//     （input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens）。
//   - `message.content` 是 block 数组，含 `tool_use`（name=Workflow/Skill/Read/...，id=
//     toolu_… 或 call_…）；user 行 content 含 `tool_result`（tool_use_id 指回完成的 tool_use）。

import type { AwareStatePatch } from "./types";
import type { SubagentNode } from "../types";

// ---- model → context window 查表（S-3 / D-8，原始 ID 前缀匹配）----
//
// 漂移点（未实测穷举，随官方变可改）：键用真实 `message.model` 原始 ID 前缀；短名兜底
// （banner 人读名 opus/sonnet 等）；`<synthetic>` 及未知 → null（不猜 → contextPct=null）。
const WINDOW_1M = 1_000_000;
const WINDOW_200K = 200_000;

/**
 * model → context window（tokens）。未知 / synthetic → null（绝不猜）。
 * 漂移点：前缀表随官方模型迭代手改（§D-8）。
 */
export function windowForModel(model: string | null | undefined): number | null {
  if (model == null) return null;
  if (model === "<synthetic>") return null;
  const m = model.toLowerCase();
  // 原始 ID 前缀（claude-<family>-<ver>...）。
  if (
    m.startsWith("claude-opus-4-") ||
    m.startsWith("claude-sonnet-4-") ||
    m.startsWith("claude-fable-5")
  ) {
    return WINDOW_1M;
  }
  if (m.startsWith("claude-haiku-4-")) {
    return WINDOW_200K;
  }
  // 短名兜底（banner 人读名）：opus/sonnet/fable → 1M、haiku → 200k。
  // 用词边界判定，避免把含子串的未知串误判。
  if (/\b(opus|sonnet|fable)\b/.test(m)) return WINDOW_1M;
  if (/\bhaiku\b/.test(m)) return WINDOW_200K;
  return null;
}

/**
 * model 是否 claude 族（JSONL 自检激活用，D-10）：用于在 PTY sniff 不命中时由 JSONL
 * 权威置 `isAgent`。复用 windowForModel 判定（claude 族 → 有窗口；`<synthetic>`/未知 → 无）。
 */
export function isClaudeModel(model: string | null | undefined): boolean {
  return windowForModel(model) !== null;
}

// ---- usage 形态（assistant message.usage 子集，只取做 ctx 的真值）----
interface JsonlUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * 当前上下文窗口占用 tokens = input + cache_read + cache_creation（§5）。
 * 缺字段按 0 处理（容错；非数字不计入）。
 */
export function contextTokensFromUsage(usage: JsonlUsage | null | undefined): number {
  if (usage == null || typeof usage !== "object") return 0;
  return (
    num(usage.input_tokens) +
    num(usage.cache_read_input_tokens) +
    num(usage.cache_creation_input_tokens)
  );
}

// ---- Workflow script 里的 meta.name 抽取（D-12）----
// 形态：script 文本里 `name: 'conmux-m2-implement'`（单/双引号皆收）。
// 实测短 scriptPath（仅路径，无 meta 块）→ 无匹配 → null（调用方兜底 "workflow"）。
const WORKFLOW_NAME_RE = /\bname:\s*['"]([^'"]+)['"]/;

/**
 * 从 Workflow tool_use 的 script 文本里取 meta 首个 `name:`（单/双引号）。
 * 无则 null（调用方据此回退 "workflow" 兜底）。
 */
export function parseWorkflowName(script: string | null | undefined): string | null {
  if (typeof script !== "string") return null;
  const m = WORKFLOW_NAME_RE.exec(script);
  return m ? m[1] : null;
}

// ---- 跨增量累加状态（前端 observer 持有，逐次读取喂入）----
/**
 * JSONL 解析累加器（跨 read_claude_jsonl 增量保留）。file basename 变（新会话）时
 * observer 重建（new initJsonlAccum），随 offset 一起重置。
 */
export interface JsonlAccum {
  /** Σ 整会话输入处理（input + cache_read + cache_creation）。 */
  sessionTokensIn: number;
  /** Σ 整会话生成（output_tokens）。 */
  sessionTokensOut: number;
  /** 最后一条「真实」assistant 消息的当前 ctx tokens（分子）；无则 null。 */
  ctxTokens: number | null;
  /** 最后一条「真实」assistant 消息的 model（权威）；无则 null。 */
  model: string | null;
  /**
   * 活跃 Workflow：block.id → name（S-2/D-12）。见匹配 tool_result.tool_use_id 即删。
   * 按 id 字面匹配（toolu_… / call_… 两种前缀都收，不依赖前缀过滤）。
   */
  activeWf: Map<string, string>;
  /** Workflow 出现序（取最近未完成项的 name 作 activeWorkflow）。 */
  wfOrder: string[];
  /** 最近一次 Skill tool_use 的 input.skill（标"recent"，非伪 live）。 */
  recentSkill: string | null;
  /**
   * 子 agent 派发跟踪（2026-07-02 审计 P0-1）：tool_use id → 节点。
   * ground truth（2026-07-02 本机实测，~/.claude/projects/<sanitized>/*.jsonl）：
   * 派发 = assistant content 的 tool_use，`name:"Agent"`（旧版名 "Task" 兼容收），
   * input 含 subagent_type / description；user 行 tool_result.tool_use_id 指回 = 完成。
   * sidechain 不写主文件（实测 isSidechain:true 0 行）、子 agent 转录在会话子目录
   * （read_claude_jsonl 不扫）→ 无嵌套误报 / 双计。完成项**保留**（会话级历史），
   * 与 activeWf 的"完成即删"语义不同。
   */
  subagents: Map<string, SubagentNode>;
  /** 子 agent 派发序（tool_use id，首次观测序）。 */
  subOrder: string[];
}

/** 全新累加器（新会话 / 切文件时重建）。 */
export function initJsonlAccum(): JsonlAccum {
  return {
    sessionTokensIn: 0,
    sessionTokensOut: 0,
    ctxTokens: null,
    model: null,
    activeWf: new Map(),
    wfOrder: [],
    recentSkill: null,
    subagents: new Map(),
    subOrder: [],
  };
}

// ---- 「真实」assistant 消息判定（M-1 / D-11，防假 0）----
// model ∉ {"<synthetic>"} 且 usage 非全零。claude 偶以 <synthetic>（中断 / stop_sequence）
// 或全零 usage 收尾——这类跳过，不更新 ctx 字段，保留上一真值。无真实消息前保 null。
function isRealAssistant(model: unknown, usage: JsonlUsage | null | undefined): boolean {
  if (model === "<synthetic>") return false;
  if (typeof model !== "string" || model.length === 0) return false;
  if (usage == null || typeof usage !== "object") return false;
  const total =
    num(usage.input_tokens) +
    num(usage.output_tokens) +
    num(usage.cache_read_input_tokens) +
    num(usage.cache_creation_input_tokens);
  return total > 0;
}

// ---- 解析返回 ----
interface ParseResult {
  patch: AwareStatePatch;
  accum: JsonlAccum;
}

/**
 * 逐行解析 JSONL 增量行，累加到 accum，产出 AwareStatePatch（M-1/S-2/S-3/L-3）。
 *
 * - assistant 行：仅「真实」消息（M-1）才更新 ctx/model + Σ 累加；synthetic / 全零跳过。
 * - tool_use：Workflow → activeWf.set(block.id, parseWorkflowName ?? "workflow")；
 *   Skill → recentSkill = input.skill。
 * - user 行 tool_result → activeWf.delete(tool_use_id)（D-12，按 id 字面匹配）。
 *
 * 坏行 / 半行 JSON.parse 失败即跳过——**不 log 行内容**（L-3 隐私）。
 * accum 原地变更（Map / 数组），返回同一引用 + 计算出的 patch。
 */
export function parseJsonlLines(lines: string[], accum: JsonlAccum): ParseResult {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      // 坏行 / 半行：跳过，绝不 log 行内容（含对话明文，L-3）。
      continue;
    }
    if (typeof rec !== "object" || rec === null) continue;
    const o = rec as Record<string, unknown>;
    const msg = o.message;
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as Record<string, unknown>;
    const type = o.type;

    if (type === "assistant") {
      const model = m.model;
      const usage = m.usage as JsonlUsage | undefined;
      if (isRealAssistant(model, usage)) {
        // ctx / model 取该真实消息（最后真实消息覆盖前值）。
        accum.ctxTokens = contextTokensFromUsage(usage);
        accum.model = model as string;
        // Σ 累加（本会话累计）。
        accum.sessionTokensIn += contextTokensFromUsage(usage);
        accum.sessionTokensOut += num(usage?.output_tokens);
      }
      // tool_use 扫描（Workflow / Skill）——无论是否真实消息都扫（工具调用与 usage 无关）。
      scanAssistantTools(m, accum);
    } else if (type === "user") {
      // tool_result 在 user 消息 content 里 → 清完成的 Workflow（D-12）。
      scanUserToolResults(m, accum);
    }
  }

  return { patch: accumToPatch(accum), accum };
}

/** 扫 assistant content 的 tool_use（Workflow → activeWf / Skill → recentSkill）。 */
function scanAssistantTools(msg: Record<string, unknown>, accum: JsonlAccum): void {
  const content = msg.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_use") continue;
    const name = b.name;
    const id = b.id;
    if (name === "Workflow" && typeof id === "string") {
      const input = b.input as Record<string, unknown> | undefined;
      // script 优先，scriptPath 兜底（实测两种键都出现）。
      const script =
        (typeof input?.script === "string" ? input.script : null) ??
        (typeof input?.scriptPath === "string" ? input.scriptPath : null);
      const wfName = parseWorkflowName(script) ?? "workflow";
      if (!accum.activeWf.has(id)) accum.wfOrder.push(id);
      accum.activeWf.set(id, wfName);
    } else if (name === "Skill") {
      const input = b.input as Record<string, unknown> | undefined;
      if (typeof input?.skill === "string") {
        accum.recentSkill = input.skill;
      }
    } else if ((name === "Agent" || name === "Task") && typeof id === "string") {
      // 子 agent 派发（P0-1 ground truth 2026-07-02：当前版名 "Agent"，"Task" 旧版兼容）。
      const input = b.input as Record<string, unknown> | undefined;
      const type =
        typeof input?.subagent_type === "string" && input.subagent_type.length > 0
          ? input.subagent_type
          : "agent"; // 省略 subagent_type = 平台默认——用中性词，不臆造具体类型名。
      const description =
        typeof input?.description === "string" ? input.description : "";
      if (!accum.subagents.has(id)) {
        accum.subOrder.push(id);
        accum.subagents.set(id, {
          type,
          description,
          status: "running",
          detail: null, // JSONL 无 "Done(…)" 摘要行——不编造 detail。
        });
      }
    }
  }
}

/** 扫 user content 的 tool_result → 删完成的 Workflow（按 tool_use_id 字面匹配，D-12）。 */
function scanUserToolResults(msg: Record<string, unknown>, accum: JsonlAccum): void {
  const content = msg.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_result") continue;
    const id = b.tool_use_id;
    if (typeof id === "string" && accum.activeWf.has(id)) {
      accum.activeWf.delete(id);
      const idx = accum.wfOrder.indexOf(id);
      if (idx >= 0) accum.wfOrder.splice(idx, 1);
    }
    // 子 agent 完成（P0-1）：tool_result 指回派发 id → done（粘性终态）；节点保留
    // （会话级历史，区别于 activeWf 的完成即删）。口径（红队 NIT 登记）：done =
    // "该派发已终结"（含 Esc 中断 / is_error 的错误返回）——不读 is_error 细分，
    // 观测层只声明终结事实，不宣称成功。
    if (typeof id === "string") {
      const node = accum.subagents.get(id);
      if (node !== undefined && node.status !== "done") {
        accum.subagents.set(id, { ...node, status: "done" });
      }
    }
  }
}

/** accum → AwareStatePatch（仅承载 usage/model/工具名子集，patch 白名单受类型约束）。 */
function accumToPatch(accum: JsonlAccum): AwareStatePatch {
  const patch: AwareStatePatch = {};

  // model（权威，JSONL 字面覆盖 PTY banner 刮取）。
  if (accum.model !== null) patch.model = accum.model;

  // ctx / tokens（当前窗口占用，取自最后真实消息）。无真实消息 → 不写（保 null，诚实「—」）。
  if (accum.ctxTokens !== null) {
    const win = windowForModel(accum.model);
    patch.tokensUsed = accum.ctxTokens;
    patch.tokensTotal = win; // 未知 model → null。
    patch.contextPct =
      win !== null && win > 0
        ? Math.round((accum.ctxTokens / win) * 100)
        : null; // 窗口未知 → contextPct=null（不猜）。
  }

  // Σ 累计（出现过真实消息才写；全程 synthetic → 保 0 但 ctxTokens 仍 null → patch 不写 ctx）。
  // sessionTokens 在有真实消息时才 >0；为避免 0 误显，只在 ctxTokens 非 null 时一并写。
  if (accum.ctxTokens !== null) {
    patch.sessionTokensIn = accum.sessionTokensIn;
    patch.sessionTokensOut = accum.sessionTokensOut;
  }

  // activeWorkflow：取最近未完成项（wfOrder 末位仍在 activeWf 里者）；空 → null。
  patch.activeWorkflow = latestActiveWorkflow(accum);

  // recentSkill：最近 Skill tool_use 的 input.skill（标"recent"）。
  patch.recentSkill = accum.recentSkill;

  // subagents（P0-1）：JSONL 是结构化权威源（tool_use/tool_result 对账，不受 TUI 改版
  // 影响）。**只在观测到过派发时写**——写空数组会让 mergePatch 的 accumulateSubagents
  // 把 PTY 已累计项全部误标 historic。
  if (accum.subOrder.length > 0) {
    patch.subagents = accum.subOrder
      .map((id) => accum.subagents.get(id))
      .filter((n): n is SubagentNode => n !== undefined)
      .map((n) => ({ ...n }));
  }

  return patch;
}

/** 取最近一个未完成 Workflow 的 name（wfOrder 末位）；无活跃 → null。 */
function latestActiveWorkflow(accum: JsonlAccum): string | null {
  for (let i = accum.wfOrder.length - 1; i >= 0; i--) {
    const id = accum.wfOrder[i];
    const name = accum.activeWf.get(id);
    if (name !== undefined) return name;
  }
  return null;
}
