// ===== M⑤c leader 键盘仲裁（CLI-home 键盘 spine）=====
//
// 规格真源：.workbench/coordination/handoffs/conmux_m5c_f1_contract.md
//   §1 leader 状态机 · §2 共存不回归 · §3 待命指示 · §4 安全（veto 级）· §7 裁决。
//
// 核心：tmux 式 leader 前缀（默认 Ctrl+Space）。
//   - 默认全透传，仅 Ctrl+Space 一个键被 conmux 取走（veto 级硬保证：永不弄坏 CLI）。
//   - 按 Ctrl+Space → arm（控制待命 standby，起 1.5s 计时）；下一个键解释为 conmux 命令后 disarm。
//   - armed 的下一个键一律 capture 阶段消费（终端收不到）；未识别键退待命（不送终端）。
//   - 1.5s 无键 或 esc → 自动退回透传。
//
// 设计裁决落地：
//   - D-1 capture 阶段拦截：addEventListener("keydown", h, true)，armed 时抢在 xterm
//     `.xterm-helper-textarea` handler 之前消费键。未 armed 不 preventDefault（透传保证）。
//   - D-4 conmux 输入框抑制 leader：activeElement 是非 xterm 的 INPUT/TEXTAREA → 不 arm。
//   - D-5 状态读模块即时态：getSessions()/getActiveId() 返回 lib/sessions live 态；
//     listener useEffect([]) 一次装配，回调走 ref 镜像避免 stale 闭包。
//
// 与现有键共存（§2，不回归）：
//   - M⑤a Ctrl+K（App bubble 监听 toggle 命令面板）：Ctrl+K ≠ Ctrl+Space，未 armed 时
//     本 capture 监听放行（不拦），Ctrl+K bubble 照常触发。
//   - M⑤b Home `n`（App bubble，仅 0 会话非输入框）：plain `n`（未 armed）放行 → Home n
//     触发；`leader+n`（armed）capture 消费为"下一会话"（0 会话时 no-op），Home n 不触发。

import { useEffect, useRef } from "react";
import { injectStdin } from "@conmux/terminal-core";
import { getActiveId, getSessions, setActive } from "./sessions";
import { leaderLiteral, matchesLeaderChord } from "./leader-key";

/** armed 自动退待命的超时（spec §1：1.5s 无键 → 退透传）。 */
const LEADER_TIMEOUT_MS = 1500;

export interface UseLeaderKeyboardOptions {
  /** 开/关命令面板（App 传 React setState；leader+: → open(true)）。 */
  setPaletteOpen: (open: boolean) => void;
  /** armed 态变化回调（App 据此持有 leaderArmed state 传 StatusBar 徽章）。 */
  onArmedChange: (armed: boolean) => void;
  /** leader+h → 开 Home overlay（M⑤d §1：App toggle homeOverlayOpen）。 */
  openHomeOverlay: () => void;
  /** leader+s → 切风格（M⑤d §1：App 传 lib/style cycleStyle，缩点条换肤钮同款）。 */
  cycleStyle: () => void;
  /**
   * 是否抑制 leader 待命（M⑤d §1 / D-2）：App 传 `() => homeOverlayOpen`。
   * 为真时未 armed 段对 Ctrl+Space 放行不 arm——Home overlay 自有键盘，
   * 不该再起待命。更保守（不增拦截面），veto 安全只增不减。
   */
  isBlocked?: () => boolean;
}

/** activeElement 是否为 conmux 自有输入框（非 xterm 的 INPUT/TEXTAREA）→ 抑制 leader（D-4）。 */
function isConmuxInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el === null) return false;
  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && !el.isContentEditable) {
    return false;
  }
  // xterm 的隐藏 textarea（.xterm-helper-textarea）不算 conmux 输入框——终端焦点应可 arm。
  if (el.classList.contains("xterm-helper-textarea")) return false;
  return true;
}

/** 是否 leader 前缀键（可配置，lib/leader-key 读 localStorage；默认 Ctrl+Space）。 */
function isLeaderKey(e: KeyboardEvent): boolean {
  return matchesLeaderChord(e);
}

/** 下一会话（循环）。无会话则 null（no-op）。 */
function nextSessionId(): string | null {
  const list = getSessions();
  if (list.length === 0) return null;
  const cur = getActiveId();
  const idx = list.findIndex((s) => s.instanceId === cur);
  // 当前 active 不在 list（异常）则从头开始。
  const base = idx === -1 ? -1 : idx;
  const next = list[(base + 1 + list.length) % list.length];
  return next.instanceId;
}

/** 上一会话（循环）。无会话则 null（no-op）。 */
function prevSessionId(): string | null {
  const list = getSessions();
  if (list.length === 0) return null;
  const cur = getActiveId();
  const idx = list.findIndex((s) => s.instanceId === cur);
  const base = idx === -1 ? 0 : idx;
  const prev = list[(base - 1 + list.length) % list.length];
  return prev.instanceId;
}

/**
 * 装配 leader 键盘仲裁（capture 阶段 document keydown）。useEffect([]) 一次装配。
 *
 * 读 lib/sessions live 态（D-5）；setPaletteOpen / onArmedChange 走 ref 镜像，
 * 即便 App 重渲染换了闭包，listener 始终调最新版本（无 stale）。
 */
export function useLeaderKeyboard(opts: UseLeaderKeyboardOptions): void {
  // ref 镜像最新回调（listener 一次装配，回调每帧可能换）。
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    // armed 态 + 超时计时只活在 effect 闭包内（单一来源，无 React state 抖动）。
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    /** 退待命：清计时 + 灭徽章。任何分支后调用（含超时）。 */
    const disarm = (): void => {
      if (!armed) return;
      armed = false;
      clearTimer();
      optsRef.current.onArmedChange(false);
    };

    /** 进待命：起 1.5s 计时 + 亮徽章。 */
    const arm = (): void => {
      armed = true;
      clearTimer();
      timer = setTimeout(() => {
        // 超时自动 disarm（退透传）；超时后的键正常进终端（armed 已 false）。
        disarm();
      }, LEADER_TIMEOUT_MS);
      optsRef.current.onArmedChange(true);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      // ---- armed（待命）：下一个键一律消费（capture 抢在终端前），解释为命令后 disarm ----
      if (armed) {
        // 忽略纯修饰键的独立 keydown（Ctrl/Shift/Alt/Meta 抬手前会先单发一次）——
        // 否则按 Ctrl+Space（先来 Ctrl 单 keydown）会把待命立即吃掉，leader-leader 永远走不到。
        if (
          e.key === "Control" ||
          e.key === "Shift" ||
          e.key === "Alt" ||
          e.key === "Meta"
        ) {
          // 不消费、不 disarm：等真正的命令键。
          return;
        }

        // armed 下所有非修饰键都被 conmux 取走（终端收不到）。
        e.preventDefault();
        e.stopPropagation();

        // leader leader（再按前缀键）→ 把字面前缀送活跃终端（tmux send-prefix）。
        // 字面按当前 chord 算（Ctrl+Space→NUL / Ctrl+字母→控制码 / Alt+键→ESC+键）；
        // 不可表示 → 空串，则 no-op（不送垃圾，诚实降级）。
        if (isLeaderKey(e)) {
          const id = getActiveId();
          const literal = leaderLiteral();
          if (id !== null && literal.length > 0) {
            void injectStdin(id, literal).catch((err) => {
              console.error("[conmux] leader-leader 注入失败:", err);
            });
          }
          disarm();
          return;
        }

        // 1-9 → jump 第 N 会话（getSessions()[N-1]）。
        if (e.code.startsWith("Digit") || /^[1-9]$/.test(e.key)) {
          const digit = e.key >= "1" && e.key <= "9" ? Number(e.key) : NaN;
          if (!Number.isNaN(digit)) {
            const target = getSessions()[digit - 1];
            if (target) setActive(target.instanceId);
            disarm();
            return;
          }
        }

        switch (e.key) {
          case "n":
          case "N": {
            const id = nextSessionId();
            if (id !== null) setActive(id);
            disarm();
            return;
          }
          case "p":
          case "P": {
            const id = prevSessionId();
            if (id !== null) setActive(id);
            disarm();
            return;
          }
          case ":": {
            optsRef.current.setPaletteOpen(true);
            disarm();
            return;
          }
          case "h":
          case "H": {
            // leader+h → 开 Home overlay（M⑤d §1）。App toggle homeOverlayOpen。
            optsRef.current.openHomeOverlay();
            disarm();
            return;
          }
          case "s":
          case "S": {
            // leader+s → 切风格（M⑤d §1 / D-4），复用 App cycleStyle。
            optsRef.current.cycleStyle();
            disarm();
            return;
          }
          case "Escape": {
            // 仅退待命（无命令）。
            disarm();
            return;
          }
          default: {
            // 未识别前缀键（tmux 式）→ 退待命且不送终端（D-3，已 preventDefault/stopPropagation）。
            disarm();
            return;
          }
        }
      }

      // ---- 未 armed ----
      // M⑤d §1 / D-2：Home overlay 开时 Ctrl+Space 应"无操作"（overlay 自有键盘）。
      // overlay 开时终端在 scrim 之下不可交互，故此处吞掉 Ctrl+Space（preventDefault+
      // stopPropagation）：既不 arm，也不让 NUL 漏进底层终端，闭合 overlay 焦点 rAF 落定前
      // 的一帧竞态（红队 M⑤d LOW-1）。其余键放行给 overlay 自己的键盘。
      // 注意：仅 overlay 开时吞 Ctrl+Space；overlay 关时此分支不入，veto 透传完全不变。
      if (optsRef.current.isBlocked?.()) {
        if (isLeaderKey(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // Ctrl+Space → arm（preventDefault + stopPropagation，避免终端收到 NUL）。
      if (isLeaderKey(e)) {
        // D-4：焦点在 conmux 自有输入框（命令面板/Home 加项打字含 Ctrl+Space）→ 不 arm，放行。
        if (isConmuxInputFocused()) return;
        e.preventDefault();
        e.stopPropagation();
        arm();
        return;
      }

      // 其余键 → 不拦（不 preventDefault / 不 stopPropagation）→ xterm 正常收（透传，veto 级）。
      // 含 Ctrl+K（M⑤a，App bubble 监听）、plain n（M⑤b Home）、Ctrl+C / Tab / 方向键 / TUI 特殊键。
    };

    // capture=true：armed 时抢在 xterm `.xterm-helper-textarea` 的 bubble handler 之前消费。
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      clearTimer();
    };
  }, []);
}
