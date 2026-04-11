// ===== XtermTerminal =====
// xterm.js wrapper themed to match Conflux's current visual language:
// - JetBrains Mono Variable 12px
// - Transparent background (so glass card shows through)
// - Accent/success/warning palette mapped to ANSI colors
//
// Props:
// - instanceId: binding key for PTY output stream + subscribe filter
// - content: optional ANSI-encoded string to write on mount (demo playback)
// - interactive: if true, keystrokes are routed to injectStdin (falls back to
//   local echo when backend unavailable)
// - subscribeToPty: if true, subscribe to conflux://pty-output events for
//   instanceId and write base64-decoded bytes to the terminal as they arrive

import { useEffect, useRef, type FC } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { onPtyOutputForInstance } from "@/lib/event-listener";
import { injectStdin } from "@/lib/tauri-bridge";

interface XtermTerminalProps {
  instanceId: string;
  content?: string;
  interactive?: boolean;
  subscribeToPty?: boolean;
}

// Theme tuned to match current Conflux card terminal look
const CONFLUX_THEME = {
  background: "rgba(0,0,0,0)",          // transparent — glass shows through
  foreground: "#B8B3B0",                 // secondary (main body text)
  cursor: "#B8D4E3",                     // accent
  cursorAccent: "#0A0F15",
  selectionBackground: "rgba(184,212,227,0.25)",
  selectionForeground: "#F2F2F2",
  // ANSI 16-color map → Conflux palette
  black: "#6B7280",            // muted gray used as "dim"
  brightBlack: "#6B7280",
  red: "#FF3B30",              // error
  brightRed: "#FF3B30",
  green: "#34C759",            // success
  brightGreen: "#34C759",
  yellow: "#FFB800",           // warning
  brightYellow: "#FFB800",
  blue: "#5AC8FA",             // info
  brightBlue: "#5AC8FA",
  magenta: "#B8D4E3",
  brightMagenta: "#B8D4E3",
  cyan: "#B8D4E3",             // accent
  brightCyan: "#B8D4E3",
  white: "#F2F2F2",            // primary
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
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.4,
      letterSpacing: 0.2,
      cursorBlink: interactive,
      cursorStyle: "block",
      cursorWidth: 2,
      disableStdin: !interactive,
      allowTransparency: true,
      scrollback: 2000,
      theme: CONFLUX_THEME,
      // Respect card boundaries — no extra padding, card already has its own
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(hostRef.current);

    // Initial fit after mount
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* container not ready yet */ }
    });

    // Watch container size changes (card resize) and refit
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
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    if (subscribeToPty) {
      onPtyOutputForInstance(instanceId, (payload) => {
        try {
          terminal.write(decodePtyChunk(payload.data));
        } catch {
          /* malformed chunk — skip */
        }
      }).then((fn) => {
        if (cancelled) { fn(); return; }
        unlisten = fn;
      }).catch(() => {
        // Tauri event bus unavailable — stay in demo mode with static content.
      });
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      cancelled = true;
      unlisten?.();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // Content/interactive/instanceId/subscribeToPty changes require full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      className="w-full h-full"
      style={{
        // Hide xterm's internal scrollbar — use our own scrollback navigation later
        // The glass card's border + padding already provides visual containment
      }}
    />
  );
};

export { XtermTerminal };
export type { XtermTerminalProps };
