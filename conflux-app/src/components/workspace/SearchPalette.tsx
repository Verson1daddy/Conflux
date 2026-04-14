// ===== SearchPalette =====
// C2-A2: Command palette with real search across agents, adapters, and commands.
// Ctrl+K opens globally (wired in App.tsx). Arrow keys navigate, Enter selects.
// Matches design/conflux.pen frame "Search 命令面板" (GY7OQ).

import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";

// ===== Icons =====

const ICON_SEARCH: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
);

const ICON_TERMINAL: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  </svg>
);

const ICON_PLUS: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5v14" />
  </svg>
);

const ICON_SETTINGS: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ICON_MSG: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ICON_PLUG: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </svg>
);

// ===== Types =====

interface SearchItem {
  id: string;
  type: "agent" | "adapter" | "command";
  title: string;
  subtitle: string;
  icon: FC<{ size: number; color: string }>;
  action: () => void;
}

interface SearchPaletteProps {
  visible: boolean;
  onClose: () => void;
  onAddAgent?: () => void;
  onSettings?: () => void;
  onDiscussion?: () => void;
}

// ===== Status dot colors =====

const STATUS_COLORS: Record<string, string> = {
  idle: "#6B7280",
  thinking: "#FFB800",
  coding: "#34C759",
  waiting_permission: "#FFB800",
  done: "#34C759",
  error: "#FF3B30",
};

// ===== Section label =====

const SectionLabel: FC<{ label: string }> = ({ label }) => (
  <div style={{ padding: "8px 16px 4px 16px" }}>
    <span style={{
      fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 600,
      letterSpacing: 1.5, color: "#6B7280", textTransform: "uppercase" as const,
    }}>
      {label}
    </span>
  </div>
);

// ===== Component =====

const SearchPalette: FC<SearchPaletteProps> = ({
  visible,
  onClose,
  onAddAgent,
  onSettings,
  onDiscussion,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const instances = useAgentStore((s) => s.instances);
  const setExpandedCard = useAgentStore((s) => s.setExpandedCard);

  // Build searchable items
  const items = useMemo<SearchItem[]>(() => {
    const result: SearchItem[] = [];

    // Commands
    if (onAddAgent) {
      result.push({ id: "cmd-new-agent", type: "command", title: "New Agent", subtitle: "Create a new agent session", icon: ICON_PLUS, action: () => { onClose(); onAddAgent(); } });
    }
    if (onSettings) {
      result.push({ id: "cmd-settings", type: "command", title: "Settings", subtitle: "Open settings panel", icon: ICON_SETTINGS, action: () => { onClose(); onSettings(); } });
    }
    if (onDiscussion) {
      result.push({ id: "cmd-discussion", type: "command", title: "New Discussion", subtitle: "Start a multi-agent discussion", icon: ICON_MSG, action: () => { onClose(); onDiscussion(); } });
    }

    // Agent instances
    instances.forEach((inst) => {
      result.push({
        id: `agent-${inst.instance_id}`,
        type: "agent",
        title: inst.display_name ? `${inst.adapter_name} · ${inst.display_name}` : inst.adapter_name,
        subtitle: `${inst.instance_id.slice(0, 8)}… · ${inst.status}`,
        icon: ICON_TERMINAL,
        action: () => { onClose(); setExpandedCard(inst.instance_id); },
      });
    });

    // Built-in adapters (static)
    for (const a of [
      { id: "claude-code", name: "Claude Code", vendor: "Anthropic" },
      { id: "codex", name: "Codex", vendor: "OpenAI" },
      { id: "aider", name: "Aider", vendor: "Paul Gauthier" },
      { id: "opencode", name: "OpenCode", vendor: "OpenCode" },
    ]) {
      result.push({
        id: `adapter-${a.id}`,
        type: "adapter",
        title: a.name,
        subtitle: `${a.vendor} · adapter`,
        icon: ICON_PLUG,
        action: () => { /* navigate to adapters tab in settings */ onClose(); onSettings?.(); },
      });
    }

    return result;
  }, [instances, onClose, onAddAgent, onSettings, onDiscussion, setExpandedCard]);

  // Filter
  const filtered = useMemo(() => {
    if (query.trim().length === 0) return items;
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.type.includes(q)
    );
  }, [items, query]);

  // Group by type for display
  const grouped = useMemo(() => {
    const commands = filtered.filter((i) => i.type === "command");
    const agents = filtered.filter((i) => i.type === "agent");
    const adapters = filtered.filter((i) => i.type === "adapter");
    // Flat list for keyboard navigation (order: commands → agents → adapters)
    const flat = [...commands, ...agents, ...adapters];
    return { commands, agents, adapters, flat };
  }, [filtered]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIdx((prev) => Math.min(prev, Math.max(0, grouped.flat.length - 1)));
  }, [grouped.flat.length]);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [visible]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const len = grouped.flat.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % Math.max(1, len));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + len) % Math.max(1, len));
      } else if (e.key === "Enter" && len > 0) {
        e.preventDefault();
        grouped.flat[selectedIdx]?.action();
      }
    },
    [grouped.flat, selectedIdx]
  );

  // ESC to close
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (!visible) return null;

  // Render a single result row
  let globalIdx = 0;
  const renderItem = (item: SearchItem) => {
    const idx = globalIdx++;
    const isSel = idx === selectedIdx;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        data-idx={idx}
        onClick={item.action}
        onMouseEnter={() => setSelectedIdx(idx)}
        className="flex items-center w-full text-left"
        style={{
          padding: "10px 16px", gap: 12, borderRadius: 6,
          background: isSel ? "rgba(255,255,255,0.07)" : "transparent",
          border: "none", cursor: "pointer",
        }}
      >
        <div className="shrink-0 flex items-center justify-center" style={{
          width: 28, height: 28, borderRadius: 6,
          background: isSel ? "rgba(184,212,227,0.12)" : "rgba(255,255,255,0.05)",
        }}>
          <Icon size={14} color={isSel ? "#B8D4E3" : "#6B7280"} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 2 }}>
          <span className="truncate" style={{
            fontFamily: "'Geist Sans',sans-serif", fontSize: 13, fontWeight: 500,
            color: isSel ? "#F2F2F2" : "#B8B3B0",
          }}>
            {item.title}
          </span>
          <span className="truncate" style={{
            fontFamily: "'Geist Sans',sans-serif", fontSize: 10,
            color: "#6B7280",
          }}>
            {item.subtitle}
          </span>
        </div>
        {item.type === "agent" && (
          <span className="shrink-0 rounded-full" style={{
            width: 6, height: 6,
            background: STATUS_COLORS[item.subtitle.split(" · ")[1] ?? "idle"] ?? "#6B7280",
          }} />
        )}
        {isSel && (
          <span style={{
            fontFamily: "'JetBrains Mono Variable',monospace", fontSize: 9,
            color: "#6B7280", padding: "2px 6px", borderRadius: 3,
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
          }}>
            ↵
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      style={{ paddingTop: "14vh" }}
    >
      <div
        className="absolute inset-0 modal-scrim-enter"
        style={{ background: "rgba(0,0,0,0.53)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative flex flex-col overflow-hidden modal-panel-enter"
        style={{
          width: 560,
          maxHeight: "60vh",
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input row */}
        <div className="flex items-center shrink-0" style={{ padding: "16px 20px", gap: 12 }}>
          <ICON_SEARCH size={18} color="#6B7280" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            placeholder="Search agents, commands, adapters…"
            className="flex-1 min-w-0 outline-none"
            style={{
              background: "transparent", border: "none",
              fontFamily: "'Geist Sans',sans-serif", fontSize: 15, color: "#F2F2F2",
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="shrink-0 flex items-center" style={{
            padding: "3px 8px", borderRadius: 4,
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.082)",
            fontFamily: "'JetBrains Mono Variable',monospace",
            fontSize: 10, fontWeight: 500, color: "#6B7280",
          }}>
            Esc
          </span>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.082)" }} />

        {/* Results */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto"
          style={{ padding: "6px 6px 10px 6px" }}
        >
          {grouped.flat.length === 0 ? (
            <div className="flex flex-col items-center justify-center" style={{ padding: "40px 0", gap: 8 }}>
              <ICON_SEARCH size={24} color="#6B728060" />
              <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 13, color: "#6B7280" }}>
                No results for "{query}"
              </span>
            </div>
          ) : (
            <>
              {grouped.commands.length > 0 && (
                <>
                  <SectionLabel label="Commands" />
                  {grouped.commands.map(renderItem)}
                </>
              )}
              {grouped.agents.length > 0 && (
                <>
                  <SectionLabel label="Agents" />
                  {grouped.agents.map(renderItem)}
                </>
              )}
              {grouped.adapters.length > 0 && (
                <>
                  <SectionLabel label="Adapters" />
                  {grouped.adapters.map(renderItem)}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="shrink-0 flex items-center" style={{
          padding: "8px 16px", gap: 12,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}>
          <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, color: "#6B728080" }}>
            ↑↓ navigate · ↵ select · esc close
          </span>
          <div className="flex-1" />
          <span style={{
            fontFamily: "'JetBrains Mono Variable',monospace", fontSize: 10,
            color: "#6B728080",
          }}>
            Ctrl+K
          </span>
        </div>
      </div>
    </div>
  );
};

export { SearchPalette };
