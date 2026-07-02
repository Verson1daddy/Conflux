// ===== session-observer（M3-ext F1 契约 §1）=====
//
// 在 XtermTerminal 之外**并行**挂一个 PTY 输出观测者：订阅 `conmux://pty-output`
// （onPtyOutputForInstance，base64 解码）→ 计 elapsed + 喂 registry parser + OSC7
// → 维护 AwareState → 经 useSyncExternalStore 广播驱动 AwareHeader 重渲染。
// 退出（onProcessExitedForInstance）→ status='exited'。
//
// 不干扰终端渲染（独立 listen，XtermTerminal 自有订阅；两者各收各的同一事件）。
//
// 诚实（§0）：
//   - 所有 LLM 元数据只由 parser 从真打印内容写入；observer 不编。
//   - 费用 / $：用户决策永久不做（字段已删；订阅边际≈$0 显金额误导）。
//   - cwd 仅 OSC7 真解析到才更新（本 demo spawn cwd=None → 初始 null）。
//   - status：最近 IDLE_MS 内有输出 = running，否则 idle；退出 = exited（不臆造活跃）。

import {
  onPtyOutputForInstance,
  onProcessExitedForInstance,
} from "@conmux/terminal-core";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { type AwareState, initialAwareState } from "./types";
import type { AwareStatePatch } from "./parsers/types";
import { ParserRegistry } from "./registry";
import { parseOsc7Cwd } from "./osc7";
import { stripAnsi, extractOscTitle } from "./ansi";
import { accumulateSubagents } from "./subagent-accum";
import {
  type JsonlAccum,
  initJsonlAccum,
  isClaudeModel,
  parseJsonlLines,
} from "./parsers/jsonl";

/** 静默多久判定为 idle（最近一次输出至今 > 此值 → idle）。 */
const IDLE_MS = 2500;
/** 活跃度 / elapsed 重算节拍（即便无新输出也要让 idle 翻转 + 耗时跑表）。 */
const TICK_MS = 1000;
/** 喂 parser 的最近原始输出缓冲上限（字符；够覆盖 banner / 状态行跨块拼接）。 */
const RAW_BUFFER_MAX = 16384;

/** JSONL 源轮询节拍（claude 会话升级后懒启）。 */
const JSONL_POLL_MS = 2500;
/**
 * 活跃度门阈值（S-1）：JSONL 文件 mtime（或末行 timestamp）距今 > 此值 → 视为陈旧 /
 * 非活跃，不喂 ctx 实时字段（防死文件冒充实时）。
 * 漂移点（未实测标定）：单 cwd 目录可累积数十历史会话 jsonl（实测一目录 49 个），
 * 60s 阈值未做实测校准，真实场景可能漂移，后续按 e2e 表现调。
 */
const JSONL_STALE_MS = 60_000;

/** read_claude_jsonl 返回的 JSON 形态（§2.3）。 */
interface JsonlReadResult {
  lines: string[];
  offset: number;
  file?: string;
  mtimeMs?: number;
}

/** subagents 数组值相等（避免每块新引用 → 每帧无谓 commit）。逐项比四字段。 */
function subagentsEqual(
  a: AwareState["subagents"],
  b: AwareState["subagents"]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.type !== y.type ||
      x.description !== y.description ||
      x.status !== y.status ||
      x.detail !== y.detail ||
      (x.historic ?? false) !== (y.historic ?? false)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 输出是否含终端响铃 BEL（`\x07`）。attention 真路由信号之一（tmux monitor-bell 语义）。
 * 用 `\x07` 转义（源码文本、运行时才是 0x07，避免 git 判 binary）。导出供单测。
 * 注：仅对**非活跃**会话有意义（活跃会话用户在打字，readline 响铃属噪声，App 会即时 ack）。
 */
export function containsBel(text: string): boolean {
  return text.includes("\x07");
}

export class SessionObserver {
  private readonly instanceId: string;
  /**
   * 启动工作目录（M⑥ §5）：OSC7 未捕获时的 JSONL cwd fallback。App 在 new 时传该会话
   * SessionEntry.cwd。可选（向后兼容旧无参 / 默认会话无 cwd）。
   */
  private readonly launchCwd: string | null;
  /**
   * 启动意图（M⑥ D-10）：launchCommand 含 claude → JSONL 源不等脆弱 PTY sniff 直接启
   * （当前 claude alt-screen TUI 不触发 sniff）。App 据 SessionEntry.launchCommand 传入。
   */
  private readonly launchIsClaude: boolean;
  /**
   * B2（2026-07-02 审计 S1）：注入启动携带的 claude `--session-id`。有值 →
   * read_claude_jsonl 精确锚定 `<id>.jsonl`（消除同 cwd 多活会话 mtime 串台）；
   * 无值（老会话 / 非注入启动 / resync 丢失）→ 后端沿用 mtime 最新（已知残留）。
   */
  private readonly launchSessionId: string | null;
  private state: AwareState = initialAwareState();
  private readonly registry = new ParserRegistry();

  private readonly listeners = new Set<() => void>();

  private startedAt = 0;
  private lastOutputAt = 0;
  private rawBuffer = ""; // 原始（含 ANSI）—— OSC7 解析用（OSC7 本身是转义序列）。
  private strippedBuffer = ""; // 去 ANSI 纯文本 —— parser sniff/parse 用（避免色码打散标记）。

  private unlistenOutput: UnlistenFn | null = null;
  private unlistenExit: UnlistenFn | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  // 代际守卫：StrictMode dev 的 start→stop→start 下，旧 start 的异步 listen
  // 解析可能晚于新 start，比对代际可把过期句柄就地解绑而非覆盖活句柄（防泄漏）。
  private generation = 0;

  // ===== JSONL 源（M⑥，仅 claude 会话升级后懒启）=====
  private jsonlTimer: ReturnType<typeof setInterval> | null = null;
  private jsonlStarted = false; // 懒启幂等（升级到 claude 后只启一次）。
  private jsonlOffset = 0; // 上次读到的字节 offset（前端持有，无状态后端，D-7）。
  private jsonlFile: string | null = null; // 当前会话 JSONL basename（变 → 重置 offset/accum）。
  private jsonlAccum: JsonlAccum = initJsonlAccum();
  private jsonlPolling = false; // 单飞：避免轮询重入（前一轮 invoke 未回时跳过本轮）。
  // P0-1（2026-07-02 审计）：JSONL 源已观测到 ≥1 次子 agent 派发 → 它成为 subagents
  // 权威源，PTY 正则提取的 subagents 被丢弃（16KB 窗口 + 工具黑名单是误报源；JSONL
  // tool_use/tool_result 结构化对账不受 TUI 改版影响）。文件切换（新会话）时复位。
  private jsonlSubagentsSeen = false;

  private readonly decoder = new TextDecoder("utf-8", { fatal: false });

  constructor(
    instanceId: string,
    launchCwd?: string,
    launchIsClaude?: boolean,
    launchSessionId?: string,
  ) {
    this.instanceId = instanceId;
    this.launchCwd = launchCwd ?? null;
    this.launchIsClaude = launchIsClaude ?? false;
    this.launchSessionId = launchSessionId ?? null;
  }

  /** 启动观测（幂等）。返回的函数停止并清理订阅 / 定时器。 */
  start(): () => void {
    if (this.started) return () => this.stop();
    this.started = true;
    const gen = ++this.generation;
    this.startedAt = Date.now();
    this.lastOutputAt = this.startedAt;

    void onPtyOutputForInstance(this.instanceId, (payload) => {
      this.onOutput(payload.data);
    }).then((un) => {
      // 已停止 / 已被更新一代的 start 取代 → 立即解绑（避免泄漏 / 覆盖活句柄）。
      if (!this.started || gen !== this.generation) un();
      else this.unlistenOutput = un;
    });

    void onProcessExitedForInstance(this.instanceId, () => {
      this.onExit();
    }).then((un) => {
      if (!this.started || gen !== this.generation) un();
      else this.unlistenExit = un;
    });

    // 节拍：刷新 elapsed + 翻转 idle（无新输出也要走）。
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);

    // 启动意图（D-10）：launchCommand 含 claude → 不等脆弱 PTY sniff，直接启 JSONL 源
    // （当前 claude alt-screen TUI 不触发 sniff；JSONL 读到 fresh claude jsonl 即权威置
    // isAgent）。无启动意图的会话仍可经 PTY sniff 升级时懒启（onOutput → startJsonlSource）。
    if (this.launchIsClaude) this.startJsonlSource();

    return () => this.stop();
  }

  stop(): void {
    this.started = false;
    this.unlistenOutput?.();
    this.unlistenExit?.();
    this.unlistenOutput = null;
    this.unlistenExit = null;
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.jsonlTimer !== null) {
      clearInterval(this.jsonlTimer);
      this.jsonlTimer = null;
    }
    this.jsonlStarted = false;
  }

  // ===== useSyncExternalStore 接口 =====

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  };

  getSnapshot = (): AwareState => this.state;

  // ===== 内部 =====

  private onOutput(base64Data: string): void {
    const text = this.decodeBase64Utf8(base64Data);
    if (text.length === 0) return;
    this.feedChunk(text);
  }

  /**
   * 喂入一块已解码的输出文本（strip→sniff upgrade→parser.parse→mergePatch→commit）。
   *
   * 从 onOutput 抽出的入口（行为零变）：onOutput 仍由 Tauri pty-output 事件回调，解码
   * base64 后委托本方法。**导出为 public 仅为可测性**——端到端 replay harness 在无
   * Tauri/无 PTY 下直接喂入分块字节，走真 stripAnsi/registry/extractSubagents/
   * accumulateSubagents 链路（不 fake parser）。原 Tauri 订阅路径不动，行为零变。
   */
  feedChunk(text: string): void {
    if (text.length === 0) return;

    const now = Date.now();
    this.lastOutputAt = now;

    // 维护最近原始缓冲（OSC7 用——OSC7 本身是转义序列），裁到上限。
    this.rawBuffer += text;
    if (this.rawBuffer.length > RAW_BUFFER_MAX) {
      this.rawBuffer = this.rawBuffer.slice(-RAW_BUFFER_MAX);
    }
    // 去 ANSI 纯文本缓冲（parser sniff/parse 用——避免色码/光标定位打散字面标记，
    // 实测 claude TUI banner 不去 ANSI 则 "Claude Code v..."/"Opus 4.8" 不连续而漏匹配）。
    const stripped = stripAnsi(text);
    this.strippedBuffer += stripped;
    if (this.strippedBuffer.length > RAW_BUFFER_MAX) {
      this.strippedBuffer = this.strippedBuffer.slice(-RAW_BUFFER_MAX);
    }

    let dirty = false;
    const next: AwareState = { ...this.state };

    // 退出后不再因残留输出复活为 running（诚实：进程已退）。
    if (next.status !== "exited") {
      if (next.status !== "running") {
        next.status = "running";
        dirty = true;
      }
    }

    // attention 真路由（MF-3）：终端响铃 BEL → 标需注意（真信号，非启发式）。
    // 在原始 text 上检测（BEL 是 C0 控制符，stripAnsi 不保证去除）。App 据 attention +
    // 非活跃 → 缩点脉冲；活跃会话由 App 即时 ack（用户在看，readline 响铃不算需注意）。
    if (!next.attention && containsBel(text)) {
      next.attention = true;
      dirty = true;
    }

    // OSC7 cwd（真解析到才更新）。
    const cwd = parseOsc7Cwd(this.rawBuffer);
    if (cwd !== null && cwd !== next.cwd) {
      next.cwd = cwd;
      dirty = true;
    }

    // parser 升级嗅探（单向粘性）——在去 ANSI 文本上嗅探。finding-1（2026-06-17）：alt-screen
    // claude 不在 scrollback 留可嗅探 banner，但 OSC 终端标题恒为 "✳ Claude Code"（版本稳定、
    // survive alt-screen）。把 raw 缓冲里的 OSC 标题追加进嗅探文本让 claude sniff 命中——
    // scrollback 的 logo 被光标定位打散成 "ClaudeCode"（无空格），故 "Claude Code" 标记基本
    // 只 OSC 标题命中（非 claude 会话需字面 echo "Claude Code" 才误报，可接受）。
    const oscTitle = extractOscTitle(this.rawBuffer);
    const sniffInput = oscTitle
      ? `${this.strippedBuffer}\n${oscTitle}`
      : this.strippedBuffer;
    const upgraded = this.registry.maybeUpgrade(sniffInput);
    const parser = this.registry.active;
    if (upgraded) {
      next.parserId = parser.id;
      next.isAgent = parser.isAgent;
      dirty = true;
      // claude 会话升级 → 懒启 JSONL 富观测源（D-10：仅 claude，其它 CLI 零变）。
      if (parser.id === "claude") this.startJsonlSource();
    }

    // 喂 parser 去 ANSI 文本（只写它能诚实确定的字段）。
    const patch = parser.parse(stripped, this.strippedBuffer);
    // P0-1：JSONL 已观测到派发 → PTY 正则的 subagents 不再入账（权威源让位），
    // patch 其余字段照喂。
    if (this.jsonlSubagentsSeen && patch.subagents !== undefined) {
      delete patch.subagents;
    }
    if (this.mergePatch(next, patch)) dirty = true;

    if (dirty) this.commit(next);
  }

  /**
   * 把 patch 合并进 next（值比较收敛；subagents 按值比，引用恒变不误触发 commit）。
   * @returns 是否有任一字段实际变化（驱动调用方 dirty）。
   */
  private mergePatch(next: AwareState, patch: AwareStatePatch): boolean {
    let dirty = false;
    for (const key of Object.keys(patch) as (keyof AwareStatePatch)[]) {
      const v = patch[key];
      if (v === undefined) continue;
      // subagents：把本轮窗口解析（v）累加进会话级历史（next.subagents 即累加器）。
      // 滚出窗口的项不丢、标 historic（持久化，2026-06-19）。值比较避免无谓 commit。
      if (key === "subagents") {
        const merged = accumulateSubagents(
          next.subagents,
          v as AwareState["subagents"]
        );
        if (!subagentsEqual(next.subagents, merged)) {
          next.subagents = merged;
          dirty = true;
        }
        continue;
      }
      if (v !== next[key]) {
        // @ts-expect-error patch 的 key 是 AwareState 的子集，赋值类型已由 patch 类型约束。
        next[key] = v;
        dirty = true;
      }
    }
    return dirty;
  }

  /**
   * 外部源（M⑥ JSONL）喂入 patch：复用 onOutput 的 patch-merge 子路径，保持 observer 为
   * AwareState 单一属主。退出态不复活（不改 status）。
   */
  applyExternalPatch(patch: AwareStatePatch): void {
    const next: AwareState = { ...this.state };
    if (this.mergePatch(next, patch)) this.commit(next);
  }

  /**
   * JSONL 自检激活（M⑥ D-10）：读到 fresh claude jsonl（model 是 claude 族）→ **权威**置
   * `isAgent=true` + `parserId="claude"` + 合并 patch（model/token/ctx/skill/workflow）。
   * 绕开脆弱 PTY 文本 sniff（当前 claude alt-screen TUI 不触发它）——JSONL 结构化真值更可靠。
   * 退出态不复活（不改 status）；单一属主仍是 observer。
   */
  applyJsonlClaudeState(patch: AwareStatePatch): void {
    const next: AwareState = { ...this.state };
    let dirty = false;
    if (!next.isAgent) {
      next.isAgent = true;
      dirty = true;
    }
    if (next.parserId !== "claude") {
      next.parserId = "claude";
      dirty = true;
    }
    if (this.mergePatch(next, patch)) dirty = true;
    if (dirty) this.commit(next);
  }

  private onExit(): void {
    const next: AwareState = {
      ...this.state,
      status: "exited",
      activity: null, // 已退出，无活动（不保留运行时残留活动文案）。
      // attention 真路由（MF-3）：进程退出 = 真信号需注意（你没在看时它结束/崩了）。
      attention: true,
    };
    this.commit(next);
  }

  /**
   * 确认 attention（App 在用户切到该会话时调用）：清 attention 标记。
   * 你看了就不再"需注意"——这是 attention 路由的"清除"半边。
   */
  acknowledgeAttention(): void {
    if (this.state.attention) {
      this.commit({ ...this.state, attention: false });
    }
  }

  private tick(): void {
    const now = Date.now();
    const next: AwareState = { ...this.state };
    let dirty = false;

    const elapsed = now - this.startedAt;
    if (elapsed !== next.elapsedMs) {
      next.elapsedMs = elapsed;
      dirty = true;
    }

    // 活跃度翻转：非退出态下，静默超时 → idle。
    if (next.status === "running" && now - this.lastOutputAt > IDLE_MS) {
      next.status = "idle";
      next.activity = null; // 空闲：清掉上次运行时活动（不残留）。
      dirty = true;
    }

    if (dirty) this.commit(next);
  }

  // ===== JSONL 富观测源（M⑥，仅 claude 会话）=====

  /**
   * 懒启 JSONL 轮询（claude 升级后调用一次，幂等）。非 claude 会话从不调用 → 永不轮询
   * （shell/WSL 零变，D-10）。stop() 清 timer。
   */
  private startJsonlSource(): void {
    if (this.jsonlStarted || !this.started) return;
    this.jsonlStarted = true;
    // 立即跑一轮（不等首个节拍），后续按节拍。
    void this.pollJsonl();
    this.jsonlTimer = setInterval(() => {
      void this.pollJsonl();
    }, JSONL_POLL_MS);
  }

  /**
   * 一轮 JSONL 增量读 + 解析 + 喂入（§5）：
   *   cwd = AwareState.cwd（OSC7 实时）?? launchCwd（启动 cwd）；空则跳过不 invoke（诚实降级）。
   *   invoke read_claude_jsonl(cwd, offset) → 检 file 变化（新会话）则重置 offset/accum →
   *   活跃度门（mtime 距今 > JSONL_STALE_MS 则不喂 ctx 实时字段，S-1）→ parseJsonlLines →
   *   applyExternalPatch + 更新 offset。单飞防重入；错误吞掉（降级，不崩）。
   */
  private async pollJsonl(): Promise<void> {
    if (!this.started || this.jsonlPolling) return;
    const cwd = this.state.cwd ?? this.launchCwd;
    if (cwd == null || cwd.length === 0) return; // cwd 未知 → 诚实降级（不 invoke），新字段保「—」。

    this.jsonlPolling = true;
    try {
      const raw = await invoke<string>("read_claude_jsonl", {
        cwd,
        offset: this.jsonlOffset,
        sessionId: this.launchSessionId, // B2：有值 → 后端精确锚定 <id>.jsonl。
      });
      if (!this.started) return; // 轮询期间被停 → 丢弃。
      const result = JSON.parse(raw) as JsonlReadResult;
      const lines = Array.isArray(result.lines) ? result.lines : [];
      const nextOffset =
        typeof result.offset === "number" ? result.offset : this.jsonlOffset;
      const file = typeof result.file === "string" ? result.file : null;
      const mtimeMs =
        typeof result.mtimeMs === "number" ? result.mtimeMs : null;

      // 文件切换（新会话 id）→ 重置 offset/accum，从头读新文件（D-7）。
      if (file !== null && this.jsonlFile !== null && file !== this.jsonlFile) {
        this.jsonlOffset = 0;
        this.jsonlAccum = initJsonlAccum();
        this.jsonlFile = file;
        this.jsonlSubagentsSeen = false; // 新会话：权威让位复位（P0-1）。
        // 本轮 lines 是按旧 offset 读的旧文件尾段——丢弃，下一轮从 0 读新文件。
        return;
      }
      if (file !== null) this.jsonlFile = file;

      // 活跃度门（S-1 + 红队 P2 SHOULD-FIX）：文件陈旧（mtime 距今 > 阈值）→ 仍解析
      // 累加 accum（保持会话累计正确，文件回到活跃即恢复显示），但**不喂任何 JSONL 派生
      // 字段**到 live 头条。死会话文件不冒充当前会话的实时 / 最近语义——只剥 ctx 不够：
      // 实测 6 天前死会话 EOF 残留 recentSkill，若只剥 ctx 会渲染「◆ xxx（最近）」源自死
      // 文件，与"最近"冲突（gate 已判该文件非 live）。Σ↑↓ 同理（死会话累计冒充当前）。
      const stale = mtimeMs !== null && Date.now() - mtimeMs > JSONL_STALE_MS;

      if (lines.length > 0) {
        const { patch } = parseJsonlLines(lines, this.jsonlAccum);
        if (!stale) {
          // P0-1：本会话 JSONL 观测到过派发 → subagents 权威源切到 JSONL。
          if (patch.subagents !== undefined && patch.subagents.length > 0) {
            this.jsonlSubagentsSeen = true;
          }
          // fresh claude jsonl（model 是 claude 族）→ JSONL **权威**置 isAgent/parserId +
          // 喂字段（绕开脆弱 PTY sniff，D-10：当前 claude alt-screen TUI 不触发 sniff）。
          // 非 claude model / 还无真实消息 → 仅喂 patch，不擅自置 agent（诚实）。
          if (isClaudeModel(patch.model)) this.applyJsonlClaudeState(patch);
          else this.applyExternalPatch(patch);
        }
        // 陈旧 → 仅推进 accum（parseJsonlLines 已推进），不喂 UI（全剥）。
      }
      this.jsonlOffset = nextOffset;
    } catch {
      // read_claude_jsonl 失败 / JSON 损坏 → 降级（保上一态，不崩、不 log 行内容 L-3）。
    } finally {
      this.jsonlPolling = false;
    }
  }

  private commit(next: AwareState): void {
    this.state = next;
    for (const l of this.listeners) l();
  }

  /** base64 → UTF-8 文本（容错；非法字节不抛，渲染为替换符）。 */
  private decodeBase64Utf8(b64: string): string {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return this.decoder.decode(bytes, { stream: true });
    } catch {
      // base64 损坏 → 跳过本块（诚实：不把垃圾喂给 parser / OSC7）。
      return "";
    }
  }
}
