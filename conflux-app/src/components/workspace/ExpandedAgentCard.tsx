// ===== ExpandedAgentCard =====
// Full focus view for a single Agent instance. Mirrors design/conflux.pen
// frame `uyacU` (800×600): TopBar + Body(Sidebar + Terminal) + Footer.
// Non-fullscreen mode uses slide-in animation; stdin is enabled on the
// expanded terminal so keystrokes echo locally (Phase B placeholder until
// backend PTY is wired).

import { Suspense, type FC, type ReactNode, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAgentStore } from "@/stores/agentStore";
import { onSubAgentCompleted, onSubAgentSpawned } from "@/lib/event-listener";
import { getAgentTree } from "@/lib/tauri-bridge";
import type { AgentStatus } from "@/types";
import { useExitActions } from "@/hooks/useExitActions";
import { useTerminalTheme } from "@/hooks/useTerminalTheme";
import { ExitActionBar } from "./ExitActionBar";

const XtermTerminal = lazy(() =>
  import("./XtermTerminal").then((module) => ({
    default: module.XtermTerminal,
  }))
);

// ===== C2-A4 Shield (shared constants with AgentCard) =====

type ShieldTier = "autonomous" | "smart" | "manual";

const SHIELD_META: Record<ShieldTier, { icon: string; color: string; label: string; desc: string }> = {
  autonomous: { icon: "shield-check", color: "#34C759", label: "Autonomous", desc: "All commands auto-approved" },
  smart:      { icon: "shield-alert", color: "#FFD60A", label: "Smart",      desc: "Only destructive actions need confirm" },
  manual:     { icon: "shield-off",   color: "#FF6B6B", label: "Manual",     desc: "Every tool call requires approval" },
};
const SHIELD_ORDER: ShieldTier[] = ["autonomous", "smart", "manual"];
const SHIELD_PATHS: Record<string, string> = {
  "shield-check": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4",
  "shield-alert": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM12 8v4M12 16h.01",
  "shield-off":   "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
};

// ===== Palette (mirrors tailwind tokens so it matches design exactly) =====

const COLORS = {
  surfacePrimary: "#0A0F15",
  surfaceSecondary: "rgba(255,255,255,0.04)",
  surfaceTertiary: "rgba(255,255,255,0.028)",
  surfaceElevated: "rgba(255,255,255,0.06)",
  borderSoft: "rgba(255,255,255,0.082)",
  borderInset: "rgba(255,255,255,0.15)",
  textPrimary: "#F2F2F2",
  textSecondary: "#B8B3B0",
  textMuted: "#6B7280",
  accent: "#B8D4E3",
  accentMuted: "rgba(184,212,227,0.15)",
  success: "#34C759",
  warning: "#FFB800",
  error: "#FF3B30",
};

const STATUS_META: Record<
  AgentStatus,
  { color: string; label: string }
> = {
  idle: { color: COLORS.textMuted, label: "Idle" },
  thinking: { color: COLORS.warning, label: "Thinking" },
  coding: { color: COLORS.success, label: "Running" },
  waiting_permission: { color: COLORS.warning, label: "Waiting" },
  done: { color: COLORS.success, label: "Done" },
  error: { color: COLORS.error, label: "Error" },
};

// ===== Inline SVG icons (lucide subset) =====

const Icon: FC<{ path: string; size?: number }> = ({ path, size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={path} />
  </svg>
);

const PATH_MINIMIZE = "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7";
const PATH_X = "M18 6 6 18M6 6l12 12";
const PATH_TIMER = "M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z";
const PATH_MSG = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

// ===== Props =====

interface ExpandedAgentCardProps {
  instanceId: string;
  /** When true, render only the inner panel filling its parent (used by
   *  AgentCard's 3D flip back face). No scrim, no fixed 800×600, no enter
   *  animation — the parent handles presentation. */
  embedded?: boolean;
}

// ===== Demo terminal content (extended from card demo) =====
// Reused structure from AgentCard's demo generator.

const ANSI = {
  reset: "\x1b[0m",
  muted: "\x1b[38;2;107;114;128m",
  accent: "\x1b[38;2;184;212;227m",
  secondary: "\x1b[38;2;184;179;176m",
  success: "\x1b[38;2;52;199;89m",
  warning: "\x1b[38;2;255;184;0m",
};

function line(color: string, text: string): string {
  return `${color}${text}${ANSI.reset}\r\n`;
}

const DEMO_EXPANDED: Record<string, string> = {
  "claude-code":
    line(ANSI.muted, "> claude --model opus task.md") +
    "\r\n" +
    line(ANSI.accent, "╭─ Task: Implement workspace canvas component") +
    line(ANSI.secondary, "│  Reading src\\components\\workspace\\Canvas.tsx...") +
    line(ANSI.secondary, "│  Reading src\\hooks\\useWorkspaceLayout.ts...") +
    line(ANSI.accent, "╰─") +
    "\r\n" +
    line(ANSI.success, "  ✓ Created Canvas.tsx with drag-and-drop grid layout") +
    line(ANSI.success, "  ✓ Added zoom controls and minimap") +
    line(ANSI.success, "  ✓ Updated package.json with react-grid-layout") +
    "\r\n" +
    line(ANSI.accent, "⠋ Writing LayoutManager.tsx...") +
    line(ANSI.muted, "  Spawning sub-agent: Code Writer") +
    "\r\n",
  codex:
    line(ANSI.muted, "> codex analyze src\\lib\\") +
    line(ANSI.warning, "Analyzing 14 files...") +
    line(ANSI.secondary, "  [████████░░] 78%") +
    line(ANSI.secondary, "  Found 3 optimization targets:") +
    line(ANSI.secondary, "    • parser.ts (O(n²) → O(n log n))") +
    line(ANSI.secondary, "    • cache.ts (redundant JSON serialization)") +
    line(ANSI.secondary, "    • api-client.ts (unnecessary async chain)") +
    "\r\n",
  aider:
    line(ANSI.muted, "Aider v0.82.0") +
    line(ANSI.secondary, "Model: opus-4 with architect mode") +
    line(ANSI.secondary, "Repo: D:\\Projects\\conflux-app") +
    "\r\n" +
    line(ANSI.muted, "Ready for input. > _"),
  opencode:
    line(ANSI.success, "> Reviewing PR #42...") +
    line(ANSI.secondary, "  3 files, 0 issues") +
    line(ANSI.success, "  ✓ Review approved"),
};

// ===== Elapsed time formatter =====
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ===== Component =====

const ExpandedAgentCard: FC<ExpandedAgentCardProps> = ({ instanceId, embedded = false }) => {
  const setExpanded = useAgentStore((s) => s.setExpandedCard);
  const openDiscussionWizard = useAgentStore((s) => s.openDiscussionWizard);
  const instance = useAgentStore((s) => s.instances.get(instanceId));
  const tree = useAgentStore((s) => s.trees.get(instanceId));
  const updateTree = useAgentStore((s) => s.updateTree);
  // jump-back 近似滚动标注（backend_abs 行号 → "约第 N 行"，4s 自动清除）
  const jumpHint = useAgentStore((s) => s.terminalJumpHint);
  const setTerminalJumpHint = useAgentStore((s) => s.setTerminalJumpHint);
  // 退出态（Q3'）：footer 动作条 + 终端区降透明
  const { exitState, handleExitAction } = useExitActions(instanceId);
  const paneBackground = useTerminalTheme().background;

  useEffect(() => {
    if (!jumpHint || jumpHint.instanceId !== instanceId) return;
    const timer = setTimeout(() => setTerminalJumpHint(null), 4000);
    return () => clearTimeout(timer);
  }, [jumpHint, instanceId, setTerminalJumpHint]);

  // C2-A4 Shield — shared with AgentCard via store
  const shieldTier = (useAgentStore(
    (s) => s.permissionTiers.get(instanceId)
  ) ?? "smart") as ShieldTier;
  const setShieldTierStore = useAgentStore((s) => s.setPermissionTier);
  const [shieldOpen, setShieldOpen] = useState(false);
  const shieldRef = useRef<HTMLDivElement>(null);
  const shieldPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shieldOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check both the trigger button area AND the portal popover
      if (
        shieldRef.current && !shieldRef.current.contains(target) &&
        shieldPopoverRef.current && !shieldPopoverRef.current.contains(target)
      ) {
        setShieldOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [shieldOpen]);
  const status = useAgentStore(
    (s) => s.statuses.get(instanceId) ?? "idle"
  ) as AgentStatus;

  useEffect(() => {
    let cancelled = false;

    const refreshTree = async (targetInstanceId: string) => {
      if (targetInstanceId !== instanceId) {
        return;
      }

      try {
        const nextTree = await getAgentTree(instanceId);
        if (!cancelled) {
          updateTree(instanceId, nextTree);
        }
      } catch {
        // Tree is optional; keep the placeholder when backend data is unavailable.
      }
    };

    void refreshTree(instanceId);

    const unlistenSpawned = onSubAgentSpawned((payload) => {
      void refreshTree(payload.instance_id);
    });
    const unlistenCompleted = onSubAgentCompleted((payload) => {
      void refreshTree(payload.instance_id);
    });

    return () => {
      cancelled = true;
      unlistenSpawned.then((fn) => fn());
      unlistenCompleted.then((fn) => fn());
    };
  }, [instanceId, updateTree]);

  // Real instances subscribe to the live PTY stream; demo instances keep
  // playing the static ANSI reel. Real and demo cards can coexist on the
  // canvas, and the expanded view here should mirror the underlying card.
  const isDemo = instanceId.startsWith("demo-");
  const demoContent = useMemo(
    () => (isDemo ? (DEMO_EXPANDED[instance?.adapter_id ?? ""] ?? "") : ""),
    [instance?.adapter_id, isDemo]
  );

  const statusMeta = STATUS_META[status] ?? STATUS_META.idle;

  // ===== Closing animation state =====
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (embedded) {
      // Embedded mode (3D flip back face) — no overlay animation, close directly
      setExpanded(null);
      return;
    }
    setIsClosing(true);
  }, [embedded, setExpanded]);

  // After exit animation completes, actually unmount
  const handleAnimationEnd = useCallback(() => {
    if (isClosing) {
      setIsClosing(false);
      setExpanded(null);
    }
  }, [isClosing, setExpanded]);

  // ===== ESC to close =====
  // 批1（审计 P1）：终端内的 ESC 属于 TUI（vim/claude 菜单等），不关面板——
  // 事件源在 .xterm 内时放行给终端。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".xterm")) return;
      e.stopPropagation();
      handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  if (!instance) return null;

  const panel = (
    <>
        {/* ===== TopBar (48) ===== */}
        <div
          className="flex items-center shrink-0"
          style={{
            height: 48,
            padding: "0 16px",
            gap: 12,
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderBottom: `1px solid ${COLORS.borderInset}`,
          }}
        >
          <span
            className="shrink-0 rounded-full"
            style={{ width: 10, height: 10, background: statusMeta.color }}
          />
          <span
            style={{
              fontFamily: "'Fraunces Variable','Fraunces',serif",
              fontSize: 18,
              fontWeight: 600,
              color: COLORS.textPrimary,
              letterSpacing: -0.2,
            }}
          >
            {instance.display_name ? `${instance.adapter_name} · ${instance.display_name}` : instance.adapter_name}
          </span>
          <span
            style={{
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 11,
              color: COLORS.textMuted,
            }}
          >
            v1.0.32
          </span>
          <div className="flex-1" />
          {/* C2-A4 Shield permission tier */}
          <div ref={shieldRef} className="shrink-0">
            <button
              className="flex items-center justify-center"
              style={{
                width: 24, height: 24, borderRadius: 6,
                background: "rgba(255,255,255,0.05)",
                color: SHIELD_META[shieldTier].color,
              }}
              onClick={() => setShieldOpen((v) => !v)}
              title={`Permissions: ${SHIELD_META[shieldTier].label}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={SHIELD_PATHS[SHIELD_META[shieldTier].icon]} />
              </svg>
            </button>
            {shieldOpen && (() => {
              // Portal to document.body — bypasses overflow:hidden AND the
              // 3D transform containing block (rotateY on AgentCard's flip
              // stage makes `position:fixed` relative to the card, not the
              // viewport). Portal escapes the entire DOM subtree.
              const rect = shieldRef.current?.getBoundingClientRect();
              const top = (rect?.bottom ?? 0) + 6;
              const right = window.innerWidth - (rect?.right ?? 0);
              return createPortal(
              <div
                ref={shieldPopoverRef}
                className="popover-enter"
                style={{
                  position: "fixed", top, right, zIndex: 99999,
                  width: 250, padding: 5, borderRadius: 12,
                  background: "#1C1E22",
                  border: "1px solid rgba(255,255,255,0.07)",
                  boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
                  display: "flex", flexDirection: "column", gap: 2,
                  transformOrigin: "top right",
                }}
              >
                {SHIELD_ORDER.map((tier) => {
                  const meta = SHIELD_META[tier];
                  const isSel = shieldTier === tier;
                  return (
                    <button
                      key={tier}
                      onClick={() => { setShieldTierStore(instanceId, tier); setShieldOpen(false); }}
                      className="flex items-center w-full text-left"
                      style={{
                        padding: "9px 10px", gap: 10, borderRadius: 8,
                        background: isSel ? `${meta.color}12` : "transparent",
                        border: "none", cursor: "pointer",
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={SHIELD_PATHS[meta.icon]} />
                      </svg>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, fontWeight: 600, color: "#F2F2F2" }}>
                          {meta.label}
                        </span>
                        <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, color: "#6B7280" }}>
                          {meta.desc}
                        </span>
                      </div>
                      {isSel && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m9 12 2 2 4-4" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>,
              document.body,
              );
            })()}
          </div>
          {/* Running pill */}
          <div
            className="flex items-center shrink-0"
            style={{
              gap: 6,
              padding: "4px 10px",
              borderRadius: 9999,
              background: `${statusMeta.color}20`,
            }}
          >
            <span
              className="rounded-full"
              style={{
                width: 6,
                height: 6,
                background: statusMeta.color,
              }}
            />
            <span
              style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 11,
                fontWeight: 500,
                color: statusMeta.color,
              }}
            >
              {statusMeta.label}
            </span>
          </div>
          <button
            className="shrink-0 flex items-center justify-center"
            style={{ color: COLORS.textMuted, width: 24, height: 24 }}
            onClick={handleClose}
            title="Minimize (Esc)"
          >
            <Icon path={PATH_MINIMIZE} size={16} />
          </button>
          <button
            className="shrink-0 flex items-center justify-center"
            style={{ color: COLORS.textMuted, width: 24, height: 24 }}
            onClick={handleClose}
            title="Close (Esc)"
          >
            <Icon path={PATH_X} size={16} />
          </button>
        </div>

        {/* ===== Body: Sidebar + Terminal ===== */}
        <div className="flex-1 min-h-0 flex">
          {/* ----- Sidebar (200) — sub-agents + agent tree ----- */}
          <aside
            className="shrink-0 flex flex-col overflow-y-auto"
            style={{
              width: 200,
              background: COLORS.surfaceTertiary,
              borderRight: `1px solid ${COLORS.borderSoft}`,
            }}
          >
            {/* Sub-agents placeholder */}
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 8,
              borderBottom: `1px solid ${COLORS.borderSoft}`, padding: 16,
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span style={{ fontFamily: "'Geist Sans', sans-serif", fontSize: 12, color: "#6B7280", textAlign: "center" }}>
                No sub-agents yet
              </span>
            </div>

            {/* Agent tree — read from store, placeholder when empty */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontFamily: "'Geist Sans',sans-serif",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 1.5,
                  color: COLORS.textMuted,
                  padding: "12px 12px 4px 12px",
                }}
              >
                AGENT TREE
              </div>
              {tree ? (
                <div className="flex flex-col" style={{ gap: 4, padding: "4px 12px 12px 16px" }}>
                  {(function renderTreeNode(node: NonNullable<typeof tree>, depth: number): ReactNode {
                    const info = node.root;
                    return (
                      <div key={info.id}>
                        <div className="flex items-center" style={{ paddingLeft: depth * 14, gap: 6 }}>
                          <span className="shrink-0" style={{
                            width: 4, height: 4, borderRadius: 9999,
                            background: info.status === "coding" ? COLORS.success
                              : info.status === "done" ? COLORS.accent
                              : COLORS.textMuted,
                          }} />
                          <span className="truncate" style={{
                            fontFamily: "'JetBrains Mono Variable',monospace",
                            fontSize: 11,
                            color: info.status === "coding" ? COLORS.textPrimary : COLORS.textSecondary,
                          }}>
                            {info.name}
                          </span>
                        </div>
                        {node.children.map((child) => renderTreeNode(child, depth + 1))}
                      </div>
                    );
                  })(tree, 0)}
                </div>
              ) : (
                <div style={{ padding: 20, textAlign: "center", color: "#6B7280", fontSize: 12 }}>
                  No activity detected
                </div>
              )}
            </div>
          </aside>

          {/* ----- Terminal area (interactive xterm) ----- */}
          <div
            data-testid="expanded-terminal-region"
            className="relative flex-1 min-w-0 min-h-0 flex overflow-hidden"
            style={{
              padding: "16px 20px",
              // 跟随终端主题底色（与 pane 无缝，去双重画框）
              background: paneBackground,
            }}
          >
            {jumpHint && jumpHint.instanceId === instanceId && jumpHint.approximate && (
              <span className="terminal-jump-hint" data-testid="terminal-jump-hint">
                约第 {jumpHint.startLine}–{jumpHint.endLine} 行 · 后端行号
              </span>
            )}
            <div
              className="min-h-0 flex-1"
              style={{
                opacity: exitState && !isDemo ? 0.45 : 1,
                transition: "opacity 0.3s ease",
              }}
            >
              <Suspense fallback={null}>
                <XtermTerminal
                  key={instanceId}
                  instanceId={instanceId}
                  content={isDemo ? demoContent : undefined}
                  interactive
                  subscribeToPty={!isDemo}
                  cardWidth={embedded ? undefined : 800}
                  onPtyExit={(p) =>
                    useAgentStore.getState().setExitState(instanceId, p)
                  }
                  isExitDetected={() =>
                    useAgentStore.getState().exitStates.has(instanceId)
                  }
                  adapterId={instance?.adapter_id}
                />
              </Suspense>
            </div>
          </div>
        </div>

        {/* ===== Footer (36)\uff1a\u5e38\u6001=\u8ba1\u65f6+Discussion\uff1b\u9000\u51fa\u6001=\u52a8\u4f5c\u6761\uff08Q3'\uff09 ===== */}
        {exitState && !isDemo ? (
          <div
            className="flex items-center shrink-0"
            style={{
              height: 36,
              padding: "0 16px",
              background: "rgba(237,135,150,0.06)",
              borderTop: "1px solid rgba(237,135,150,0.3)",
            }}
          >
            <ExitActionBar payload={exitState} onAction={(a) => void handleExitAction(a)} />
          </div>
        ) : (
        <div
          className="flex items-center shrink-0"
          style={{
            height: 36,
            padding: "0 16px",
            gap: 12,
            background: COLORS.surfaceTertiary,
            borderTop: `1px solid ${COLORS.borderSoft}`,
          }}
        >
          <FooterItem icon={PATH_TIMER} label={instance?.created_at ? formatElapsed(Date.now() - instance.created_at) : "\u2014"} />
          <div className="flex-1" />
          <button
            data-no-expand
            onClick={(e) => {
              e.stopPropagation();
              openDiscussionWizard({ sourceInstanceId: instanceId });
            }}
            className="flex items-center"
            style={{
              gap: 4,
              padding: "4px 10px",
              borderRadius: 9999,
              background: COLORS.accentMuted,
              color: COLORS.accent,
              cursor: "pointer",
              border: "none",
            }}
            title="Open discussion"
            aria-label="Open discussion"
          >
            <Icon path={PATH_MSG} size={12} />
            <span
              style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              Discussion
            </span>
          </button>
        </div>
        )}
    </>
  );

  // ===== Embedded mode: render the panel directly into the parent (used
  // as the back face of AgentCard's 3D flip). =====
  if (embedded) {
    return (
      <div
        className="w-full h-full flex flex-col overflow-hidden"
        style={{
          background: COLORS.surfacePrimary,
          border: `1px solid ${COLORS.borderSoft}`,
          borderRadius: 12,
        }}
      >
        {panel}
      </div>
    );
  }

  // ===== Overlay mode: full-screen scrim + centered floating panel. =====
  return (
    <div
      className={`absolute inset-0 z-40 flex items-stretch justify-stretch ${isClosing ? "expanded-exit" : "expanded-enter"}`}
      style={{
        background: "rgba(5,5,7,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={handleClose}
      onAnimationEnd={handleAnimationEnd}
    >
      <div
        className={`m-auto flex flex-col overflow-hidden ${isClosing ? "expanded-panel-exit" : "expanded-panel-enter"}`}
        style={{
          width: "min(800px, 92%)",
          height: "min(600px, 88%)",
          background: COLORS.surfacePrimary,
          border: `1px solid ${COLORS.borderSoft}`,
          borderRadius: 16,
          boxShadow:
            "0 32px 80px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {panel}
      </div>
    </div>
  );
};

// ===== Small footer helpers =====

const FooterItem: FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <div
    className="flex items-center"
    style={{ gap: 6, color: COLORS.textMuted }}
  >
    <Icon path={icon} size={12} />
    <span
      style={{
        fontFamily: "'Geist Sans',sans-serif",
        fontSize: 11,
      }}
    >
      {label}
    </span>
  </div>
);

export { ExpandedAgentCard };
export type { ExpandedAgentCardProps };
