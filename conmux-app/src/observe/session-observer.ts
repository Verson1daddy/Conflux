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
//   - cost 恒 null（不接、不算、不编）。
//   - cwd 仅 OSC7 真解析到才更新（本 demo spawn cwd=None → 初始 null）。
//   - status：最近 IDLE_MS 内有输出 = running，否则 idle；退出 = exited（不臆造活跃）。

import {
  onPtyOutputForInstance,
  onProcessExitedForInstance,
} from "@conmux/terminal-core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { type AwareState, initialAwareState } from "./types";
import { ParserRegistry } from "./registry";
import { parseOsc7Cwd } from "./osc7";
import { stripAnsi } from "./ansi";

/** 静默多久判定为 idle（最近一次输出至今 > 此值 → idle）。 */
const IDLE_MS = 2500;
/** 活跃度 / elapsed 重算节拍（即便无新输出也要让 idle 翻转 + 耗时跑表）。 */
const TICK_MS = 1000;
/** 喂 parser 的最近原始输出缓冲上限（字符；够覆盖 banner / 状态行跨块拼接）。 */
const RAW_BUFFER_MAX = 16384;

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
      x.detail !== y.detail
    ) {
      return false;
    }
  }
  return true;
}

export class SessionObserver {
  private readonly instanceId: string;
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

  private readonly decoder = new TextDecoder("utf-8", { fatal: false });

  constructor(instanceId: string) {
    this.instanceId = instanceId;
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

    // OSC7 cwd（真解析到才更新）。
    const cwd = parseOsc7Cwd(this.rawBuffer);
    if (cwd !== null && cwd !== next.cwd) {
      next.cwd = cwd;
      dirty = true;
    }

    // parser 升级嗅探（单向粘性）——在去 ANSI 文本上嗅探。
    const upgraded = this.registry.maybeUpgrade(this.strippedBuffer);
    const parser = this.registry.active;
    if (upgraded) {
      next.parserId = parser.id;
      next.isAgent = parser.isAgent;
      dirty = true;
    }

    // 喂 parser 去 ANSI 文本（只写它能诚实确定的字段）。
    const patch = parser.parse(stripped, this.strippedBuffer);
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      const v = patch[key];
      if (v === undefined) continue;
      // subagents 是数组——每次 parse 都是新引用，用值比较避免每块无谓 commit
      // （[] !== [] 恒真会导致每个输出块都重渲；§D-4 允许信息态 flicker，但仍按值收敛）。
      if (key === "subagents") {
        if (!subagentsEqual(next.subagents, v as AwareState["subagents"])) {
          next.subagents = v as AwareState["subagents"];
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

    if (dirty) this.commit(next);
  }

  private onExit(): void {
    const next: AwareState = {
      ...this.state,
      status: "exited",
      activity: null, // 已退出，无活动（不保留运行时残留活动文案）。
    };
    this.commit(next);
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
