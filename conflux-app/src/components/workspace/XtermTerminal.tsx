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

import { useCallback, useEffect, useRef, type FC } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import {
  onProcessExitedForInstance,
  onPtyOutputForInstance,
} from "@/lib/event-listener";
import {
  destroyAgentInstance,
  getPtyHistory,
  injectStdin,
  isProcessExited,
  resizePty,
  respawnAgentInstance,
} from "@/lib/tauri-bridge";
import { useAgentStore } from "@/stores/agentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ExitOverlay } from "./ExitOverlay";

interface XtermTerminalProps {
  instanceId: string;
  content?: string;
  interactive?: boolean;
  subscribeToPty?: boolean;
  cardWidth?: number;
}

/** Compute terminal font size proportional to card width. */
function computeFontSize(cardWidth: number | undefined): number {
  if (!cardWidth) return 13;
  const BASE_WIDTH = 580;
  const BASE_FONT = 13;
  const MIN_FONT = 8;
  const MAX_FONT = 16;
  return Math.round(Math.min(MAX_FONT, Math.max(MIN_FONT, BASE_FONT * (cardWidth / BASE_WIDTH))));
}

// Opaque Conflux-dark surface for the terminal area. Must be opaque — WebGL
// renderer refuses transparent backgrounds, and even with DOM renderer a
// transparent terminal fights with glyph anti-aliasing and looks muddy.
const TERMINAL_BG = "#0A0F15";

// Theme tuned to match the Conflux palette.
const CONFLUX_THEME = {
  background: TERMINAL_BG,
  foreground: "#E8E3DF",                 // slightly brighter than before so glyphs pop
  cursor: "#B8D4E3",                     // accent
  cursorAccent: "#0A0F15",
  selectionBackground: "rgba(184,212,227,0.3)",
  selectionForeground: "#F2F2F2",
  // ANSI 16-color map → Conflux palette
  black: "#3A3F4A",
  brightBlack: "#6B7280",
  red: "#FF6B6B",
  brightRed: "#FF3B30",
  green: "#5FD47F",
  brightGreen: "#34C759",
  yellow: "#FFD166",
  brightYellow: "#FFB800",
  blue: "#7FC8FF",
  brightBlue: "#5AC8FA",
  magenta: "#C8B5E3",
  brightMagenta: "#B8D4E3",
  cyan: "#B8D4E3",
  brightCyan: "#D4E9F0",
  white: "#E8E3DF",
  brightWhite: "#F2F2F2",
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
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // C2-T1 Exit Overlay · read exit state from agentStore (NOT local state)
  // so that resize/flip/expand toggles that unmount this component don't
  // lose the "process is dead" signal. The store survives remounts, so
  // when the xterm comes back the overlay instantly reappears.
  const exitState = useAgentStore(
    (s) => s.exitStates.get(instanceId) ?? null
  );
  const setExitStateStore = useAgentStore((s) => s.setExitState);

  const instanceLookup = useAgentStore((s) => s.instances);
  const addInstanceAction = useAgentStore((s) => s.addInstance);
  const removeInstanceAction = useAgentStore((s) => s.removeInstance);
  const removeCardAction = useWorkspaceStore((s) => s.removeCard);

  // Adapter display name for the overlay title. Falls back to the raw
  // adapter_id from the exit payload (e.g. "Claude Code" vs "claude-code").
  const adapterName =
    instanceLookup.get(instanceId)?.adapter_name ??
    exitState?.adapter_id ??
    "Agent";

  const handleExitAction = useCallback(
    async (action: "restart" | "shell" | "close") => {
      if (action === "close") {
        // Destroy backend process (best-effort) + drop from stores so the
        // card disappears from the canvas.
        try {
          await destroyAgentInstance(instanceId);
        } catch (err) {
          // Backend may already have gc'd the entry — ignore and still
          // clear the frontend state so the user isn't stuck.
          console.error("[XtermTerminal] destroy on close failed:", err);
        }
        removeCardAction(instanceId);
        removeInstanceAction(instanceId);
        return;
      }

      // Restart / Shell: hit the respawn command. On success, replace the
      // instance metadata and clear the overlay so the xterm resumes
      // receiving new PTY chunks (they'll arrive on the same channel).
      try {
        const next = await respawnAgentInstance(instanceId, action);
        addInstanceAction(next);
        setExitStateStore(instanceId, null);
        // Clear the terminal visually so the new session starts on a
        // blank slate — the history buffer is the old (exited) process.
        terminalRef.current?.clear();
        terminalRef.current?.reset();
        // Force refit + notify the new PTY of the current terminal
        // dimensions. Without this the new PTY defaults to 120×30 while
        // the xterm grid is much smaller → TUI layout corruption.
        try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
        const cols = terminalRef.current?.cols;
        const rows = terminalRef.current?.rows;
        if (cols && rows) {
          resizePty(instanceId, cols, rows).catch(() => {});
        }
      } catch (err) {
        console.error("[XtermTerminal] respawn failed:", err);
        // Leave the overlay in place; user can still close the card.
      }
    },
    [
      instanceId,
      addInstanceAction,
      removeCardAction,
      removeInstanceAction,
      setExitStateStore,
    ]
  );

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

  useEffect(() => {
    if (!hostRef.current) return;

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
      theme: CONFLUX_THEME,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      // Smooth scrolling + minimum contrast boost improve legibility on
      // dark backgrounds without touching individual color tokens.
      smoothScrollDuration: 120,
      minimumContrastRatio: 1.2,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(hostRef.current);

    // Load WebGL renderer best-effort. This has to happen AFTER open() so
    // the canvas element exists; if the host OS / GPU refuses WebGL2 we
    // catch the error and fall back to the default DOM renderer.
    let webglAddon: WebglAddon | undefined;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        // Chromium can drop the WebGL context under memory pressure. Dispose
        // the addon so xterm falls back to DOM instead of freezing.
        webglAddon?.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (err) {
      console.warn("[XtermTerminal] WebGL renderer unavailable — using DOM fallback.", err);
      webglAddon = undefined;
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
    // Track whether the first resize has been sent. Card previews
    // (interactive=false) send exactly ONE initial resize so the PTY starts
    // at the right column count instead of the default 120. After that,
    // only the interactive expanded terminal keeps resizing — otherwise
    // two terminals fight over the same PTY grid and TUI accumulates errors.
    let initialResizeSent = false;
    const notifyBackendResize = (cols: number, rows: number) => {
      if (!subscribeToPty) return;
      if (!interactive && initialResizeSent) return;
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
    resizeObserver.observe(hostRef.current);

    // Write initial content (demo or replayed history)
    if (content) {
      terminal.write(content);
    }

    // Interactive mode: route keystrokes to backend stdin, fall back to local
    // echo when the backend rejects (e.g. demo mode without a real PTY).
    if (interactive) {
      terminal.onData((data) => {
        if (subscribeToPty) {
          injectStdin(instanceId, data, "user_direct").catch(() => {
            // Backend unavailable or PTY gone — echo locally so the user
            // still sees their keystrokes instead of a frozen terminal.
            terminal.write(data);
          });
        } else {
          terminal.write(data);
        }
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
        try {
          const history = await getPtyHistory(instanceId);
          if (cancelled) return;
          if (history.length > 0) {
            try { terminal.write(decodePtyChunk(history)); } catch { /* ignore */ }
          }
        } catch {
          // Instance not found yet or backend unavailable — skip replay and
          // go straight to live subscribe. The card will simply start
          // receiving chunks from "now" without the pre-mount history.
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
            useAgentStore.getState().setExitState(instanceId, payload);
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

    // C2-T1 belt-and-suspenders: poll is_process_exited every 2s as
    // fallback in case the event-based detection never fires (Windows
    // ConPTY reader hang). Only active when subscribeToPty=true AND no
    // exit has been detected yet. Stops as soon as we see exitState set.
    let exitPollTimer: ReturnType<typeof setInterval> | null = null;
    if (subscribeToPty) {
      exitPollTimer = setInterval(async () => {
        // If exit already detected, skip this tick but do NOT clearInterval.
        // The interval must stay alive so that after a respawn (which clears
        // exitState), the next tick picks up the new process's exit. This
        // fixes the "restart once → second exit undetected" bug.
        const already = useAgentStore.getState().exitStates.get(instanceId);
        if (already) return;
        try {
          const done = await isProcessExited(instanceId);
          if (done) {
            useAgentStore.getState().setExitState(instanceId, {
              instance_id: instanceId,
              adapter_id: useAgentStore.getState().instances.get(instanceId)?.adapter_id ?? "unknown",
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
      unlisten?.();
      unlistenExit?.();
      resizeObserver.disconnect();
      webglAddon?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // Content/interactive/instanceId/subscribeToPty changes require full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative w-full h-full"
      style={{
        background: TERMINAL_BG,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {exitState && (
        <ExitOverlay
          payload={exitState}
          adapterName={adapterName}
          onAction={handleExitAction}
        />
      )}
    </div>
  );
};

export { XtermTerminal };
export type { XtermTerminalProps };
