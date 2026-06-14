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

    return patch;
  },
};
