// ===== claude parser（M3-ext F1 契约 §1 / §2）=====
//
// 仅从 claude CLI **真打印**到 PTY 的内容提取字段。拿不到一律不写 patch key
// （→ 上游保持 null → UI 显 `—`）。**绝不猜、绝不编**（§0 铁律，红队重点核）。
//
// 诚实边界（红队对照 §2）：
//   model      ← 仅当 banner / 状态行真打印模型名（如 "claude-...-..." / "Sonnet"/"Opus"
//                带版本）才提取；否则 null。
//   tokens     ← 多数 claude 版本**不**把 token 计数打到终端 → 大概率 null（可接受）。
//                仅当输出真出现明确的 "N tokens" / "N/M tokens" 才解析。
//   contextPct ← 仅当真打印 "NN% context" / "context left: NN%" 才解析；否则 null。
//   cost       ← 本 parser **从不**输出 cost（终端不打印、无 API）；observer 恒置 null。
//   activity   ← 仅当真打印可识别状态动词（思考 / 执行 / 等待批准等）才提取；
//                泛化 spinner（"esc to interrupt"）→ running 但 activity 仍可 null
//                （observer 据 status 泛化文案，不在此编具体活动）。

import type { AgentParser, AwareStatePatch } from "./types";
import type { SubagentNode } from "../types";

// ---- sniff：claude CLI 启动 banner / 稳定特征 ----
// 用多个稳定可观测标记的并集（任一命中即认定 claude）。这些字符串来自 claude code
// 终端真实打印的稳定文案，而非推测；命不中 = 不升级（回落 shell，诚实）。
const CLAUDE_SNIFF_MARKERS: RegExp[] = [
  /Welcome to Claude Code/i,
  /Claude Code v\d/i,
  /\besc to interrupt\b/i, // claude 运行时 spinner 提示行
  /\/help for help/i, // claude 启动后底部提示
  /\banthropic\b.*\bclaude\b/i,
  // 实测 claude v2.1.177（2026-06-15 ground truth）：banner 的 "Claude Code" 在 OSC-0
  // 窗口标题里（被 stripAnsi 移除）、logo 区被光标定位打散——故上面的标记对真 TUI 不中。
  // 但模型加载行 "Using Opus 4.8 (1M context)" 是干净单行（仅前缀色码，剥 CSI 后连续），
  // 最可靠；用它 + "(1M context)" 兜底嗅探（同行 model 正则随即可提取）。
  /\bUsing\s+(?:Opus|Sonnet|Haiku)\s+[\d.]/i,
  /\(1M context\)/i,
  // finding-1（2026-06-17）：当前 claude 全 alt-screen TUI，上面的 scrollback 标记多不中
  // （banner 在 OSC 标题被 strip、logo 被光标定位打散成 "ClaudeCode" 无空格）。但 OSC 终端
  // 标题恒为 "✳ Claude Code"（版本稳定、survive alt-screen）——observer 把 OSC 标题追加进嗅探
  // 文本，此带空格标记命中标题（scrollback 打散的 "ClaudeCode" 不含空格故不误中）。
  /\bClaude Code\b/i,
];

export function sniffClaude(recentOutput: string): boolean {
  return CLAUDE_SNIFF_MARKERS.some((re) => re.test(recentOutput));
}

// ---- model 提取（仅真打印才认）----
// 形态 1：完整模型 id（claude-<family>-<ver>...），claude 偶在 banner / status 打印。
const MODEL_ID_RE = /\b(claude-[a-z0-9]+(?:-[a-z0-9.]+)+)\b/i;
// 形态 2：banner 里的 "Model: Xxx" 显式标注。
const MODEL_LABEL_RE = /\bmodel:\s*([A-Za-z0-9][\w .-]{1,40}?)\s*(?:[\r\n│|]|$)/i;
// 形态 3：claude code banner / "Using X" 的人读模型名（Opus/Sonnet/Haiku X.Y [(1M context)]）。
// 实测 claude v2.1.177 真打印 "Opus 4.8 (1M context)" / "Using Opus 4.8 (1M context)"
// （2026-06-15 conmux-app e2e ground truth），旧的 claude-<id>/Model: 形态对不上。
const MODEL_FAMILY_RE =
  /\b(?:Using\s+)?((?:Opus|Sonnet|Haiku)\s+[\d.]+(?:\s*\(1M context\))?)/i;

function extractModel(text: string): string | null {
  const idM = MODEL_ID_RE.exec(text);
  if (idM) return idM[1];
  const familyM = MODEL_FAMILY_RE.exec(text);
  if (familyM) return familyM[1].trim();
  const labelM = MODEL_LABEL_RE.exec(text);
  if (labelM) return labelM[1].trim();
  return null;
}

// ---- tokens 提取（仅真打印才认；多数版本不打印 → 多为 null）----
// 形态："12,345/200,000 tokens" 或 "12345 tokens"。
const TOKENS_PAIR_RE = /\b([\d,]+)\s*\/\s*([\d,]+)\s*tokens?\b/i;
const TOKENS_SINGLE_RE = /\b([\d,]+)\s*tokens?\b/i;

function toInt(s: string): number {
  return parseInt(s.replace(/,/g, ""), 10);
}

function extractTokens(
  text: string
): { used: number | null; total: number | null } | null {
  const pair = TOKENS_PAIR_RE.exec(text);
  if (pair) {
    const used = toInt(pair[1]);
    const total = toInt(pair[2]);
    if (Number.isFinite(used) && Number.isFinite(total)) {
      return { used, total };
    }
  }
  const single = TOKENS_SINGLE_RE.exec(text);
  if (single) {
    const used = toInt(single[1]);
    if (Number.isFinite(used)) return { used, total: null };
  }
  return null;
}

// ---- context% 提取（仅真打印才认）----
// 形态："NN% context" / "context left: NN%" / "context: NN%"。
const CONTEXT_PCT_RE =
  /(?:context\s*(?:left)?\s*:?\s*(\d{1,3})\s*%|(\d{1,3})\s*%\s*context)/i;

function extractContextPct(text: string): number | null {
  const m = CONTEXT_PCT_RE.exec(text);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

// ---- activity 提取（仅真打印的可识别状态动词才认）----
// claude 运行时常打印形如 "✻ Thinking…" / "· Crafting…" 的状态行（动词 + 省略号）。
// 只在真匹配到「首字母大写动词 + 进行态省略号」时提取该动词短语；否则 null
// （observer 会据 running/idle 泛化为「运行中/空闲」，不在此编具体活动）。
const ACTIVITY_RE =
  /(?:^|[\r\n])\s*(?:[✻✽✢·*●○]\s*)?([A-Z][a-z]+(?:ing|ed)?)[….]{1,3}/m;

function extractActivity(text: string): string | null {
  const m = ACTIVITY_RE.exec(text);
  if (!m) return null;
  const verb = m[1].trim();
  // 过滤掉明显非活动的普通句首词（保守：只认进行态 -ing，最像活动指示）。
  if (!/ing$/i.test(verb)) return null;
  return verb;
}

// ---- subagent 树提取（M3-ext-2 §2，深 agent 观测 v2）----
// ground truth（claude v2.1.177，2026-06-15）：claude 在对话流里**提交**派发行 +
// 完成折叠行（scrollback 稳定追加内容，非底部重绘区），可靠可解析：
//   ● Explore(List files in current folder)           ← 派发行（committed）
//      ⎿  Initializing…                                ← 运行中折叠行
//      ⌊ Done (1 tool use · 18.9k tokens · 16s)        ← 完成折叠行
//
// 诚实铁律（§0）：只认 strippedBuffer 窗口内真实出现的派发行；status 取折叠行字面，
// 解析不到 → 缺省 "running" + detail=null（绝不编造）；扁平一层（不臆造更深嵌套）。

// 派发行：大写/字母词**紧贴 `(`**（无空格）→ 天然排除散文括号
//   "● The Explore subagent finished ... folder (C:\\...)" 的 "folder (" 有空格不中。
const SUBAGENT_DISPATCH_RE = /●\s*([A-Za-z][\w-]*)\(([^)\n]{1,80})\)/g;
// 折叠状态行：`⎿`(U+23BF) 或 `⌊`(U+230A)（帧间变体，两者都收）。
const SUBAGENT_FOLD_RE = /[⎿⌊]\s*([^\n]{1,80})/;
// done 判定（折叠行含独立词 Done）。
const SUBAGENT_DONE_RE = /\bDone\b/;
// 派发行后向下找折叠行的窗口（行数）：claude 折叠行就在派发行下一行附近，
// 限窄窗口避免误抓后一个 subagent 的折叠行。
const FOLD_LOOKAHEAD_LINES = 3;

// 工具调用排除（e2e ground-truth 2026-06-15 发现）：claude 把**工具调用**渲染成与
// subagent 派发**完全相同**的 `● Name(args)` 形式（如 `● Bash(ls -la /c/Users/zwm)`、
// `● Read(...)`）。subagent 树只该显**子 agent**（Explore/Plan/general-purpose/自定义），
// 不该把工具调用误标为 subagent。工具集有限已知 → 黑名单排除（比 agent 类型白名单鲁棒：
// 自定义 agent 名开放，不可穷举）。MCP 工具名含 `__`（mcp__server__tool）一并排除。
const BUILTIN_TOOL_NAMES = new Set<string>([
  "Bash", "Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "LS",
  "NotebookEdit", "NotebookRead", "WebFetch", "WebSearch", "TodoWrite",
  "Task", "BashOutput", "KillShell", "KillBash", "SlashCommand",
  "ExitPlanMode", "Skill", "Search",
]);

/**
 * 从 strippedBuffer 提取扁平 subagent 列表（按派发序，(type,description) 去重，
 * done 覆盖 running）。无可观测子 agent → `[]`（诚实空）。
 * 排除工具调用（BUILTIN_TOOL_NAMES + MCP `__`）——它们与 subagent 同形但非子 agent。
 */
export function extractSubagents(strippedBuffer: string): SubagentNode[] {
  // 用去 ANSI 的全文按派发序累积；末次状态优先（done 覆盖 running）。
  const order: string[] = []; // 去重键的出现序（"type description"）。
  const byKey = new Map<string, SubagentNode>();
  const lines = strippedBuffer.split("\n");

  const re = new RegExp(SUBAGENT_DISPATCH_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(strippedBuffer)) !== null) {
    const type = m[1];
    const description = m[2].trim();
    if (description.length === 0) continue;
    // 工具调用排除：Bash/Read/… 与 MCP（mcp__server__tool）非子 agent。
    if (BUILTIN_TOOL_NAMES.has(type) || type.includes("__")) continue;

    // 折叠状态：在派发行所在行之后就近 FOLD_LOOKAHEAD_LINES 行内找折叠行。
    const dispatchLineIdx = lineIndexOfOffset(m.index, lines);
    let status: SubagentNode["status"] = "running";
    let detail: string | null = null;
    if (dispatchLineIdx >= 0) {
      for (
        let i = dispatchLineIdx + 1;
        i <= dispatchLineIdx + FOLD_LOOKAHEAD_LINES && i < lines.length;
        i++
      ) {
        const fm = SUBAGENT_FOLD_RE.exec(lines[i]);
        if (!fm) continue;
        const foldText = fm[1].trim();
        if (SUBAGENT_DONE_RE.test(foldText)) {
          status = "done";
          detail = foldText;
        }
        // 命中折叠行即停（最就近一行的状态为准）。运行中折叠行 → 保持 running + detail=null。
        break;
      }
    }

    const key = `${type} ${description}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      order.push(key);
      byKey.set(key, { type, description, status, detail });
    } else {
      // 去重归并：done 覆盖 running（同一 subagent 后出现的 done 帧优先）。
      if (status === "done") {
        existing.status = "done";
        existing.detail = detail;
      }
    }
  }

  return order.map((k) => byKey.get(k)!);
}

/** 给定字符偏移，返回它落在第几行（0-based）；找不到返回 -1。 */
function lineIndexOfOffset(offset: number, lines: string[]): number {
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    // +1 为被 split 吃掉的换行符。
    const lineEnd = acc + lines[i].length;
    if (offset <= lineEnd) return i;
    acc = lineEnd + 1;
  }
  return -1;
}

export const claudeParser: AgentParser = {
  id: "claude",
  isAgent: true,
  sniff: sniffClaude,
  parse(chunk: string, recentRaw: string): AwareStatePatch {
    const patch: AwareStatePatch = {};

    // model / tokens / context：在最近原始缓冲（含本块）里找，提到才写。
    const model = extractModel(recentRaw);
    if (model !== null) patch.model = model;

    const tokens = extractTokens(recentRaw);
    if (tokens) {
      patch.tokensUsed = tokens.used;
      patch.tokensTotal = tokens.total;
    }

    const ctx = extractContextPct(recentRaw);
    if (ctx !== null) patch.contextPct = ctx;

    // activity：只看本块新内容（活动是瞬时态，不回填旧缓冲）。
    const activity = extractActivity(chunk);
    if (activity !== null) patch.activity = activity;

    // subagents：在最近去 ANSI 缓冲全文上重算（窗口内真出现的派发行才认）。
    // 无论空否都写——空数组反映「当前无」，merge 的引用 diff 会让树从有到无消失（§D-4）。
    patch.subagents = extractSubagents(recentRaw);

    return patch;
  },
};
