// ===== ANSI/VT 转义剥离（M3-ext：parser 纯文本匹配用）=====
//
// agent CLI（claude 等）的 TUI 输出满是 ANSI 色码 / 光标定位 / OSC，会把字面标记
// （"Claude Code v..." / "Using Opus 4.8 ..."）打散，导致 sniff / model 正则在原始流上
// 匹配不到。parser 应在**去 ANSI 的纯文本**上匹配；OSC7（本身是转义序列）仍走原始 raw
// 缓冲（见 session-observer：rawBuffer 给 OSC7，strippedBuffer 给 parser）。
//
// 诚实：剥离只去控制序列、不改可见文本——匹配到的仍是终端真打印的字符。
// ReDoS 安全：均为有界 / 负字符类，无嵌套回溯。
// 用 "\x1b" 字符串 + new RegExp 拼接（与 osc7.ts 同款、已验证可存活），避免正则字面量
// 里的转义被工具通道吞掉。

const ESC = "\x1b";
const BEL = "\x07";

// OSC：ESC ] ...payload... (BEL | ESC\)
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
// CSI：ESC [ 参数... 终止字节
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
// 其它 ESC 短序列：ESC + 单字节（ESC( ESC) ESC= ESC> ESC\ 等）
const SHORT_RE = new RegExp(`${ESC}[@-Z\\\\\\]^_a-z=><]`, "g");

export function stripAnsi(s: string): string {
  return s.replace(OSC_RE, "").replace(CSI_RE, "").replace(SHORT_RE, "");
}

// OSC 窗口/图标标题：ESC ] 0|1|2 ; <title> (BEL | ESC\)。OSC 7（cwd）的 7 不在 [0-2]，不误收。
// finding-1（2026-06-17）：alt-screen claude 不在 scrollback 留可嗅探 banner，但终端标题恒设
// "✳ Claude Code"（版本稳定、survive alt-screen）——用它嗅探 claude（见 session-observer）。
const OSC_TITLE_RE = new RegExp(
  `${ESC}\\]([0-2]);([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`,
  "g"
);

/** 提取 buffer 内**最后一个** OSC 0/1/2 标题（窗口/图标标题）payload，无则 null。 */
export function extractOscTitle(s: string): string | null {
  OSC_TITLE_RE.lastIndex = 0;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = OSC_TITLE_RE.exec(s)) !== null) {
    last = m[2];
  }
  return last;
}
