// ===== ExpandedAgentCard =====
// Full focus view for a single Agent instance. Mirrors design/conflux.pen
// frame `uyacU` (800×600): TopBar + Body(Sidebar + Terminal) + Footer.
// Non-fullscreen mode uses slide-in animation; stdin is enabled on the
// expanded terminal so keystrokes echo locally (Phase B placeholder until
// backend PTY is wired).

import { type FC, useEffect, useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { XtermTerminal } from "./XtermTerminal";
import type { AgentStatus } from "@/types";

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
const PATH_GIT_BRANCH = "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM15 6a9 9 0 0 0-9 9";
const PATH_TIMER = "M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z";
const PATH_FILE = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v6h6M16 13H8M16 17H8M10 9H8";
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

// ===== Demo sub-agents and tree (mock until backend AgentTree feed) =====

interface DemoSubAgent {
  name: string;
  status: "running" | "waiting";
  task: string;
  time: string;
}

const DEMO_SUB_AGENTS: DemoSubAgent[] = [
  {
    name: "Code Writer",
    status: "running",
    task: "Writing LayoutManager.tsx",
    time: "0:42",
  },
  {
    name: "Test Runner",
    status: "waiting",
    task: "Queued · vitest",
    time: "—",
  },
];

interface DemoTreeNode {
  label: string;
  depth: number;
  status: "active" | "done" | "pending";
}

const DEMO_TREE: DemoTreeNode[] = [
  { label: "claude-code (root)", depth: 0, status: "active" },
  { label: "Code Writer", depth: 1, status: "active" },
  { label: "Context Gather", depth: 1, status: "done" },
  { label: "vitest runner", depth: 2, status: "pending" },
];

// ===== Component =====

const ExpandedAgentCard: FC<ExpandedAgentCardProps> = ({ instanceId, embedded = false }) => {
  const setExpanded = useAgentStore((s) => s.setExpandedCard);
  const openDiscussionWizard = useAgentStore((s) => s.openDiscussionWizard);
  const instance = useAgentStore((s) => s.instances.get(instanceId));
  const status = useAgentStore(
    (s) => s.statuses.get(instanceId) ?? "idle"
  ) as AgentStatus;

  const demoContent = useMemo(
    () => DEMO_EXPANDED[instance?.adapter_id ?? ""] ?? "",
    [instance?.adapter_id]
  );

  const statusMeta = STATUS_META[status] ?? STATUS_META.idle;

  // ===== ESC to close =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setExpanded(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setExpanded]);

  const handleClose = () => setExpanded(null);

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
            {instance.adapter_name}
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
          {/* ----- Sidebar (200) ----- */}
          <aside
            className="shrink-0 flex flex-col overflow-y-auto"
            style={{
              width: 200,
              padding: 12,
              gap: 12,
              background: COLORS.surfaceTertiary,
              borderRight: `1px solid ${COLORS.borderSoft}`,
            }}
          >
            <div
              style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 1.5,
                color: COLORS.textMuted,
                paddingTop: 4,
              }}
            >
              SUB-AGENTS
            </div>
            <div className="flex flex-col" style={{ gap: 8 }}>
              {DEMO_SUB_AGENTS.map((sa, i) => (
                <div
                  key={i}
                  className="flex items-start"
                  style={{
                    padding: "8px 10px",
                    gap: 8,
                    borderRadius: 8,
                    background:
                      sa.status === "running"
                        ? COLORS.surfaceElevated
                        : COLORS.surfaceSecondary,
                    border: `1px solid ${COLORS.borderSoft}`,
                  }}
                >
                  <span
                    className="rounded-full shrink-0"
                    style={{
                      width: 6,
                      height: 6,
                      marginTop: 6,
                      background:
                        sa.status === "running"
                          ? COLORS.success
                          : COLORS.accent,
                    }}
                  />
                  <div className="flex flex-col min-w-0" style={{ gap: 2 }}>
                    <span
                      className="truncate"
                      style={{
                        fontFamily: "'Geist Sans',sans-serif",
                        fontSize: 12,
                        fontWeight: 600,
                        color: COLORS.textPrimary,
                      }}
                    >
                      {sa.name}
                    </span>
                    <span
                      className="truncate"
                      style={{
                        fontFamily: "'Geist Sans',sans-serif",
                        fontSize: 10,
                        color: COLORS.textMuted,
                      }}
                    >
                      {sa.task}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 1.5,
                color: COLORS.textMuted,
                paddingTop: 4,
              }}
            >
              AGENT TREE
            </div>
            <div className="flex flex-col" style={{ gap: 4, paddingLeft: 4 }}>
              {DEMO_TREE.map((node, i) => (
                <div
                  key={i}
                  className="flex items-center"
                  style={{
                    paddingLeft: node.depth * 14,
                    gap: 6,
                  }}
                >
                  <span
                    className="shrink-0"
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 9999,
                      background:
                        node.status === "active"
                          ? COLORS.success
                          : node.status === "done"
                            ? COLORS.accent
                            : COLORS.textMuted,
                    }}
                  />
                  <span
                    className="truncate"
                    style={{
                      fontFamily: "'JetBrains Mono Variable',monospace",
                      fontSize: 11,
                      color:
                        node.status === "active"
                          ? COLORS.textPrimary
                          : COLORS.textSecondary,
                    }}
                  >
                    {node.label}
                  </span>
                </div>
              ))}
            </div>
          </aside>

          {/* ----- Terminal area (interactive xterm) ----- */}
          <div
            className="flex-1 min-w-0"
            style={{
              padding: "16px 20px",
              background: COLORS.surfacePrimary,
            }}
          >
            <XtermTerminal
              instanceId={`expanded-${instanceId}`}
              content={demoContent}
              interactive
            />
          </div>
        </div>

        {/* ===== Footer (36) ===== */}
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
          <FooterItem icon={PATH_GIT_BRANCH} label="2 sub-agents" />
          <Separator />
          <FooterItem icon={PATH_TIMER} label="3m 24s" />
          <Separator />
          <FooterItem icon={PATH_FILE} label="4 files changed" />
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
      className="absolute inset-0 z-40 flex items-stretch justify-stretch expanded-enter"
      style={{
        background: "rgba(5,5,7,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={handleClose}
    >
      <div
        className="m-auto flex flex-col overflow-hidden expanded-panel-enter"
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

const Separator: FC = () => (
  <span
    className="shrink-0"
    style={{
      width: 1,
      height: 14,
      background: COLORS.borderSoft,
    }}
  />
);

export { ExpandedAgentCard };
export type { ExpandedAgentCardProps };
