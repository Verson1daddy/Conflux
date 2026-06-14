// ===== XtermTerminal =====
// xterm.js wrapper themed to match Conflux's visual language.
//
// Renderer strategy (2026-04-12):
//   WebGL addon is loaded best-effort after `terminal.open()`. WebGL gives
//   pixel-perfect glyph rendering and correct grid alignment — the DOM
//   fallback looks blurry on Windows DPI-scaled screens and breaks TUI
//   layouts. WebGL does NOT support transparent backgrounds, so we run the
//   terminal on an opaque Conflux-dark surface (#0A0F15). The card's glass
//   header / footer provide the frosted chrome around it.
//
// Font:
//   JetBrains Mono Variable 13px / lineHeight 1.2 / letterSpacing 0 — a
//   terminal-authentic stack. Previous 12/1.4/0.2 broke grid alignment and
//   made multi-line TUI drawings wobble.
//
// Props:
// - instanceId: binding key for PTY output stream + subscribe filter
// - content: optional ANSI-encoded string to write on mount (demo playback)
// - interactive: if true, keystrokes are routed to injectStdin (falls back
//   to local echo when backend unavailable)
// - subscribeToPty: if true, drain OutputBuffer history then subscribe to
//   conflux://pty-output events for instanceId and write base64-decoded
//   bytes to the terminal as they arrive.

import { useEffect, useRef, useState, type FC } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  getPtyHistory,
  injectStdin,
  isProcessExited,
  resizePty,
  onProcessExitedForInstance,
  onPtyOutputForInstance,
} from "./ipc";
import {
  copyTextToClipboard,
  createTerminalInputController,
} from "./terminal-input";
import { shouldStopTerminalWheelPropagation } from "./terminal-wheel";
import { registerTerminal, unregisterTerminal } from "./xterm-registry";
import {
  getCurrentTerminalTheme,
  subscribeTerminalTheme,
  toXtermTheme,
} from "./terminal-theme";
import { isStaleExitSignal } from "./exit-guard";
import { useTerminalTheme } from "./useTerminalTheme";
import type { ProcessExitedPayload } from "./pty-types";

interface XtermTerminalProps {
  instanceId: string;
  content?: string;
  interactive?: boolean;
  subscribeToPty?: boolean;
  cardWidth?: number;
  replayHistory?: boolean;
  allowPreviewResizeSync?: boolean;
  /** PTY 退出回调（事件或轮询检测到时调用）。终端只负责检测；退出态归属由宿主
   *  决定（conflux=agentStore，conmux=各自会话态）——保持 terminal-core agent 无关。 */
  onPtyExit?: (payload: ProcessExitedPayload) => void;
  /** 查询该实例是否已被宿主记为退出（轮询去重 + respawn 后归零）。 */
  isExitDetected?: () => boolean;
  /** 轮询兜底合成退出 payload 用的 adapter_id（事件路径用后端真值，无需此项）。 */
  adapterId?: string;
}

interface LoadedWebglAddon {
  dispose: () => void;
  onContextLoss: (callback: () => void) => void;
}

/** Compute terminal font size proportional to card width. */
function computeFontSize(cardWidth: number | undefined): number {
  if (!cardWidth) return 13;
  const BASE_WIDTH = 580;
  const BASE_FONT = 13;
  const MIN_FONT = 9;
  const MAX_FONT = 18;
  return Math.round(Math.min(MAX_FONT, Math.max(MIN_FONT, BASE_FONT * (cardWidth / BASE_WIDTH))));
}

// Opaque Conflux-dark surface for the terminal area. Must be opaque — WebGL
// renderer refuses transparent backgrounds, and even with DOM renderer a
// transparent terminal fights with glyph anti-aliasing and looks muddy.
// 2026-06-12 默认预置 = D7 体系①蓝墨（用户实机裁决：暖炭在冷蓝壳内不搭，
// 降为可选预置；多预置注册表归 conmux 侧，见 Q4b'）。
const TERMINAL_BG = "#1E2030";

// Theme tuned to match the Conflux palette.
// D7 主题体系（mux 契约 D7）默认预置：B pastel 语义色板 × ①蓝墨暗底。
// 容器层 16 色归此主题；agent truecolor 内容透传不重映射（D8 颜色所有权分层）。
// 精确值取自用户验收样稿源数据 research/mux-theme-samples/b-backgrounds.html。
// Q4b'（conmux base24 预置注册表 + Settings 选择器）落地后此硬编码退役。
const CONFLUX_THEME = {
  background: TERMINAL_BG,
  foreground: "#CAD3F5",
  cursor: "#F4DBD6",
  cursorAccent: "#1E2030",
  selectionBackground: "#363A4F",
  selectionForeground: "#CAD3F5",
  // ANSI 16 色 → B pastel（暗版语义前景，固定）+ 蓝墨灰阶槽
  black: "#363A4F",
  brightBlack: "#494D64",
  red: "#ED8796",
  brightRed: "#F0949F",
  green: "#A6DA95",
  brightGreen: "#B0E0A0",
  yellow: "#EED49F",
  brightYellow: "#F2DBAA",
  blue: "#8AADF4",
  brightBlue: "#97B5F6",
  magenta: "#C6A0F6",
  brightMagenta: "#CFADF8",
  cyan: "#8BD5CA",
  brightCyan: "#98DBD2",
  white: "#B8C0E0",
  brightWhite: "#CAD3F5",
};

// Base64 decode to Uint8Array, then UTF-8 decode → string for xterm write.
// Backend emits chunks as they arrive; we pass them through losslessly.
function decodePtyChunk(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

const XtermTerminal: FC<XtermTerminalProps> = ({
  instanceId,
  content,
  interactive = false,
  subscribeToPty = false,
  cardWidth,
  replayHistory = true,
  allowPreviewResizeSync = false,
  onPtyExit,
  isExitDetected,
  adapterId,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [sendFailure, setSendFailure] = useState<string | null>(null);
  const themeBackground = useTerminalTheme().background;

  // Rescale terminal font size when the card is resized.
  useEffect(() => {
    if (terminalRef.current && cardWidth) {
      const newSize = computeFontSize(cardWidth);
      if (terminalRef.current.options.fontSize !== newSize) {
        terminalRef.current.options.fontSize = newSize;
        fitAddonRef.current?.fit();
      }
    }
  }, [cardWidth]);

  // 批1 根治：allowPreviewResizeSync 入 ref（每渲染同步），挂载 effect 的闭包
  // 读 ref 而非快照——prop 变更即时生效，消除"必须重挂载才能换行为"的旧约束
  //（termRefreshKey 机制的存在原因，已废除）。
  const allowPreviewResizeSyncRef = useRef(allowPreviewResizeSync);
  allowPreviewResizeSyncRef.current = allowPreviewResizeSync;

  // PTY 网格单一所有权：展开态（交互终端）独占期间预览停发 resizePty；
  // 展开态卸载后 allowPreviewResizeSync false→true 翻转 = 归还所有权，
  // 预览 refit 并把 PTY resize 回自己的网格（展开态曾把它撑到大网格）。
  const prevAllowSyncRef = useRef(allowPreviewResizeSync);
  useEffect(() => {
    const was = prevAllowSyncRef.current;
    prevAllowSyncRef.current = allowPreviewResizeSync;
    if (interactive || !subscribeToPty) return;
    if (was || !allowPreviewResizeSync) return; // 仅 false→true 翻转
    const term = terminalRef.current;
    if (!term) return;
    try {
      fitAddonRef.current?.fit();
    } catch {
      /* container not ready */
    }
    resizePty(instanceId, term.cols, term.rows).catch(() => {
      // 实例可能已销毁——忽略。
    });
  }, [allowPreviewResizeSync, interactive, subscribeToPty, instanceId]);

  useEffect(() => {
    if (!hostRef.current) return;

    const host = hostRef.current;
    const terminal = new Terminal({
      fontFamily:
        "'JetBrains Mono Variable', 'JetBrains Mono', 'Cascadia Mono', 'Consolas', monospace",
      fontSize: 13,
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: interactive,
      cursorStyle: "block",
      cursorWidth: 2,
      disableStdin: !interactive,
      // Opaque — WebGL renderer requires this; DOM fallback also looks
      // crisper against a solid background.
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
      scrollback: 5000,
      // false（2026-06-12 批1 修正）：ConPTY 每次 resize 都以 ED2 清屏开头重绘，
      // true 会把每帧旧屏推进 scrollback —— 展开/收起一次就多一份 banner（用户
      // 实测截图复现）。TUI 型 CLI（claude 等）本就高频重绘，true 只会让
      // scrollback 充满重绘垃圾帧。
      scrollOnEraseInDisplay: false,
      scrollOnUserInput: true,
      scrollSensitivity: 1.4,
      theme: CONFLUX_THEME,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      windowsPty: { backend: "conpty" },
      // Smooth scrolling + minimum contrast boost improve legibility on
      // dark backgrounds without touching individual color tokens.
      smoothScrollDuration: 120,
      minimumContrastRatio: 1.2,
    });
    // 当前主题（挂载时取值；后续切换经订阅实时下发，无需重挂载）
    terminal.options.theme = toXtermTheme(getCurrentTerminalTheme());
    const unsubTheme = subscribeTerminalTheme(() => {
      terminal.options.theme = toXtermTheme(getCurrentTerminalTheme());
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(host);

    const stopWheelPropagation = (event: WheelEvent) => {
      if (shouldStopTerminalWheelPropagation(event, interactive)) {
        event.stopPropagation();
      }
    };
    host.addEventListener("wheel", stopWheelPropagation, { passive: true });

    // Load WebGL renderer best-effort. This has to happen AFTER open() so
    // the canvas element exists; if the host OS / GPU refuses WebGL2 we
    // catch the error and fall back to the default DOM renderer.
    let webglAddon: LoadedWebglAddon | undefined;
    if (interactive) {
      void (async () => {
        try {
          const module = await import("@xterm/addon-webgl");
          if (terminalRef.current !== terminal) {
            return;
          }

          const addon = new module.WebglAddon() as LoadedWebglAddon;
          addon.onContextLoss(() => {
            addon.dispose();
            if (webglAddon === addon) {
              webglAddon = undefined;
            }
          });
          terminal.loadAddon(addon as never);
          webglAddon = addon;
        } catch (err) {
      console.warn("[XtermTerminal] WebGL renderer unavailable — using DOM fallback.", err);
        }
      })();
    }

    // Forward xterm grid-size changes to the backend PTY master so that
    // SIGWINCH-aware CLIs (claude, aider, codex, etc.) re-flow their TUI
    // layouts when the card is resized. Without this the PTY stays at its
    // spawn default (120x30) and box-drawing glyphs fall out of alignment.
    //
    // Debounced 80ms so a continuous drag doesn't hammer the IPC channel;
    // the final onResize call always wins because the timer is cleared on
    // every event.
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    // Track whether the first resize has been sent. Preview cards normally
    // send just one initial resize, but when preview resize sync is enabled
    // they keep updating the PTY so the folded terminal stays aligned after
    // card size/layout changes.
    // 批1：读 ref 而非闭包快照——展开态挂载时 allowPreviewResizeSync 翻 false
    // 立即生效（预览让出 PTY 网格所有权），无需重挂载。
    let initialResizeSent = false;
    const notifyBackendResize = (cols: number, rows: number) => {
      if (!subscribeToPty) return;
      if (!interactive && initialResizeSent && !allowPreviewResizeSyncRef.current) return;
      initialResizeSent = true;
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        resizePty(instanceId, cols, rows).catch(() => {
          // Instance may have been destroyed mid-drag — ignore.
        });
      }, 80);
    };
    terminal.onResize((size) => {
      notifyBackendResize(size.cols, size.rows);
    });

    // Initial fit after mount. Defer twice so the browser has laid out the
    // flex container before fit() measures the pixel dimensions — one RAF
    // tick is sometimes not enough under StrictMode. fit() will synchronously
    // trigger onResize if the grid shape changed, which in turn schedules
    // the initial notifyBackendResize — we don't need a separate call.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* container not ready yet */ }
      });
    });

    // Watch container size changes (card resize) and refit. fit() will
    // emit terminal.onResize when cols/rows actually change.
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(host);

    // Write initial content (demo or replayed history)
    if (content) {
      terminal.write(content);
    }

    // Interactive mode: route keystrokes to backend stdin, fall back to local
    // echo when the backend rejects (e.g. demo mode without a real PTY).
    let inputDisposable: { dispose: () => void } | undefined;
    if (interactive) {
      const inputController = createTerminalInputController({
        hasSelection: () => terminal.hasSelection(),
        getSelection: () => terminal.getSelection(),
        copyText: copyTextToClipboard,
        sendData: (data) => {
          if (subscribeToPty) {
            return injectStdin(instanceId, data);
          }
          terminal.write(data);
        },
        echoLocal: (data) => {
          terminal.write(data);
        },
        allowEchoFallback: !subscribeToPty,
        onSendSuccess: () => {
          setSendFailure(null);
        },
        onSendFailure: (data) => {
          if (subscribeToPty && data.trim().length > 0) {
            setSendFailure(`Input failed to reach the live PTY: ${JSON.stringify(data)}`);
            return;
          }
          if (subscribeToPty) {
            setSendFailure("Input failed to reach the live PTY.");
          }
        },
      });

      inputDisposable = terminal.onData((data) => {
        inputController.handleData(data);
      });
    }

    // Subscribe to real PTY output stream.
    // Race-safe: if the component unmounts before the listen() promise
    // resolves, `cancelled` flips and we call the unlisten immediately.
    //
    // Drain the OutputBuffer first. This is critical for two scenarios:
    //   1. ExpandedAgentCard mounts long after the card itself — without
    //      a history replay the expanded xterm is blank because the PTY
    //      already emitted everything while it was closed.
    //   2. The card itself was created slightly after spawn_command() ran,
    //      so the first few chunks (the onboarding banner) may have
    //      arrived before the subscription took effect.
    //
    // Order: fetch history → write → subscribe. Any chunks arriving in
    // the ~tens-of-ms between the history read and the subscription are a
    // theoretical race window. In practice spawning a CLI is followed by
    // a long idle period (waiting for user input) so it's fine; we can
    // tighten this with a seq-id in C2 if it bites.
    let unlisten: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let cancelled = false;
    if (subscribeToPty) {
      (async () => {
        if (replayHistory) {
          try {
            const history = await getPtyHistory(instanceId);
            if (cancelled) return;
            if (history.length > 0) {
              try {
                terminal.clear();
                terminal.write(decodePtyChunk(history));
              } catch {
                /* ignore */
              }
            }
          } catch {
            // Instance not found yet or backend unavailable — skip replay and
            // go straight to live subscribe. The card will simply start
            // receiving chunks from "now" without the pre-mount history.
          }
        }
        if (cancelled) return;
        try {
          const fn = await onPtyOutputForInstance(instanceId, (payload) => {
            try {
              terminal.write(decodePtyChunk(payload.data));
            } catch {
              /* malformed chunk — skip */
            }
          });
          if (cancelled) { fn(); return; }
          unlisten = fn;
        } catch {
          // Tauri event bus unavailable — stay in demo mode with static content.
        }

        // C2-T1 Exit Overlay · subscribe to process exit events for this
        // instance. The callback writes into the global store so the exit
        // survives XtermTerminal remounts (flip/resize/collapse).
        try {
          const fnExit = await onProcessExitedForInstance(instanceId, (payload) => {
            // exit-guard：respawn 抑制窗内的迟到退出事件（旧 pane）丢弃，
            // 否则动作条会在重启后立刻复现（用户实测的"重启循环"）。
            if (isStaleExitSignal(instanceId)) return;
            onPtyExit?.(payload);
          });
          if (cancelled) { fnExit(); return; }
          unlistenExit = fnExit;
        } catch {
          // Event bus unavailable — no overlay, but xterm still works.
        }
      })();
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    // jump-back 滚动用注册表（交互终端后挂载覆盖预览，恰是滚动目标）。
    registerTerminal(instanceId, terminal);

    // C2-T1 belt-and-suspenders: poll is_process_exited every 2s as
    // fallback in case the event-based detection never fires.
    // 2026-06-12 扩展到所有订阅 PTY 的终端（原仅交互终端）：实测 ProcessExited
    // 事件存在丢失窗口（后端 is_process_exited=true 而前端无感知），预览卡
    // 必须有轮询兜底。is_process_exited 是廉价锁查，≤10 卡 2s 粒度无压力。
    let exitPollTimer: ReturnType<typeof setInterval> | null = null;
    if (subscribeToPty) {
      exitPollTimer = setInterval(async () => {
        // If exit already detected, skip this tick but do NOT clearInterval.
        // The interval must stay alive so that after a respawn (which clears
        // exitState), the next tick picks up the new process's exit. This
        // fixes the "restart once → second exit undetected" bug.
        const already = isExitDetected?.() ?? false;
        if (already) return;
        try {
          const done = await isProcessExited(instanceId);
          if (done && !isStaleExitSignal(instanceId)) {
            onPtyExit?.({
              instance_id: instanceId,
              adapter_id: adapterId ?? "unknown",
              exit_code: null,
              signal: null,
              timestamp: Date.now(),
            });
          }
        } catch {
          // Instance not found (already destroyed) — stop polling.
          if (exitPollTimer) clearInterval(exitPollTimer);
          exitPollTimer = null;
        }
      }, 2000);
    }

    return () => {
      cancelled = true;
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      if (exitPollTimer) clearInterval(exitPollTimer);
      unsubTheme();
      unlisten?.();
      unlistenExit?.();
      inputDisposable?.dispose();
      resizeObserver.disconnect();
      host.removeEventListener("wheel", stopWheelPropagation);
      webglAddon?.dispose();
      unregisterTerminal(instanceId, terminal);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // Content/interactive/instanceId/subscribeToPty changes require full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      data-testid="xterm-terminal-shell"
      className="relative w-full h-full"
      style={{
        // 跟随当前主题底色；通铺无圆角（卡片侧已去双重画框，用户反馈）
        background: themeBackground,
        overflow: "hidden",
      }}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {sendFailure && (
        <div
          className="absolute left-2 right-2 top-2 z-10 rounded-md border px-2 py-1 text-[11px]"
          style={{
            background: "rgba(120, 18, 18, 0.88)",
            borderColor: "rgba(255, 99, 99, 0.35)",
            color: "#FFD7D7",
          }}
        >
          {sendFailure}
        </div>
      )}
      {/* 退出态 UI 已迁出至卡片 footer 动作条（ExitActionBar，质感批 Q3'）；
          本组件只负责退出检测（事件 + 轮询）写入 agentStore。 */}
    </div>
  );
};

export { XtermTerminal };
export type { XtermTerminalProps };
