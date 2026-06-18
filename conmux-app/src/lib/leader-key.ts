// ===== leader 前缀键配置（可配置化，2026-06-19）=====
//
// M⑤c 的 leader 前缀原硬编码 Ctrl+Space。本模块让它可配置（localStorage 持久），
// 并保住核心 veto 不变量：**前缀必须带 Ctrl 或 Alt**——裸键作前缀会把每次按键吞成
// leader、弄坏 CLI，绝不允许。lib/leader.ts 读本模块匹配 + 算 leader-leader 字面。
//
// 控制字符（NUL/ESC）一律用转义 `\x00`/`\x1b`（源码文本、运行时才是控制字节），
// 避免 git 判 binary。

const STORAGE_KEY = "conmux.leaderKey";

/** leader 前缀组合键。code = KeyboardEvent.code（布局无关）；key = 兜底/标签用。 */
export interface LeaderChord {
  ctrl: boolean;
  alt: boolean;
  /** KeyboardEvent.code，e.g. "Space" / "KeyB" / "Digit1"。 */
  code: string;
  /** KeyboardEvent.key，e.g. " " / "b" / "1"（兜底匹配 + 标签）。 */
  key: string;
}

/** 默认前缀 = Ctrl+Space（M⑤c 原值）。 */
export const DEFAULT_LEADER: LeaderChord = {
  ctrl: true,
  alt: false,
  code: "Space",
  key: " ",
};

/** 校验：形状合法 + 必须带 Ctrl 或 Alt（veto 安全）+ code 非空非纯修饰键。 */
export function isValidChord(v: unknown): v is LeaderChord {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (typeof c.ctrl !== "boolean" || typeof c.alt !== "boolean") return false;
  if (typeof c.code !== "string" || typeof c.key !== "string") return false;
  if (c.code.length === 0) return false;
  if (!c.ctrl && !c.alt) return false; // 必须带一个修饰键
  // 纯修饰键不能作前缀键。
  if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(c.code)) {
    return false;
  }
  return true;
}

function load(): LeaderChord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_LEADER };
    const parsed: unknown = JSON.parse(raw);
    if (isValidChord(parsed)) return parsed;
  } catch {
    /* 损坏 / 无 localStorage → 默认 */
  }
  return { ...DEFAULT_LEADER };
}

let current: LeaderChord = load();
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function getLeaderChord(): LeaderChord {
  return current;
}

/** 设置前缀（非法值忽略，守不变量）。持久化 + 广播。 */
export function setLeaderChord(chord: LeaderChord): void {
  if (!isValidChord(chord)) return;
  current = chord;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chord));
  } catch {
    /* 私密模式等 — 内存里仍生效 */
  }
  notify();
}

/** 恢复默认（Ctrl+Space）。 */
export function resetLeaderChord(): void {
  setLeaderChord({ ...DEFAULT_LEADER });
}

export function subscribeLeaderChord(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * KeyboardEvent 是否匹配 leader 前缀（精确修饰键）：ctrl/alt 须与配置一致，
 * shift/meta 必须未按（避免 Ctrl+Shift+Space 误中 Ctrl+Space），code 或 key 命中。
 */
export function matchesLeaderChord(
  e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code" | "key">,
  chord: LeaderChord = current
): boolean {
  if (e.ctrlKey !== chord.ctrl) return false;
  if (e.altKey !== chord.alt) return false;
  if (e.shiftKey || e.metaKey) return false;
  return e.code === chord.code || e.key === chord.key;
}

/**
 * leader-leader（send-prefix）送给活跃终端的字面字节（tmux send-prefix 语义）：
 *   - Ctrl+Space → NUL（\x00）
 *   - Ctrl+A..Z  → 对应控制码（\x01..\x1a）
 *   - Alt+<单字符> → ESC + 该字符（终端 meta 惯例）
 *   - 其余不可表示 → ""（leader-leader 诚实降级为 no-op，不送垃圾）
 */
export function leaderLiteral(chord: LeaderChord = current): string {
  if (chord.ctrl && !chord.alt) {
    if (chord.code === "Space") return "\x00";
    const m = /^Key([A-Z])$/.exec(chord.code);
    if (m) return String.fromCharCode(m[1].charCodeAt(0) - 64); // A(65)→1
  }
  if (chord.alt && !chord.ctrl) {
    if (chord.key.length === 1) return `\x1b${chord.key}`;
  }
  return "";
}

/** code/key → 显示键名（"Space" / "B" / "1" / 原 key）。 */
function keyLabel(code: string, key: string): string {
  if (code === "Space") return "Space";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (key.length === 1) return key.toUpperCase();
  return key || code;
}

/** 人类可读前缀标签：⌃Space / ⌃B / ⌥K / ⌃⌥Space。 */
export function formatLeaderLabel(chord: LeaderChord = current): string {
  const mods: string[] = [];
  if (chord.ctrl) mods.push("⌃");
  if (chord.alt) mods.push("⌥");
  return `${mods.join("")}${keyLabel(chord.code, chord.key)}`;
}
