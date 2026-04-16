// ===== ArtifactsDrawer — Discussion Artifacts Bottom Drawer =====
// Slides up from the bottom of the chatroom when the artifacts button is clicked.
// Shows all code blocks extracted from the discussion messages, with:
//   - Artifact list (language label, preview, Pin/Draft status)
//   - Preview area (selected artifact with syntax highlight + copy)
//   - Pin/Draft toggle per artifact
//   - Copy-to-clipboard for each artifact

import { type FC, useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import type { DiscussionMessage } from "@/stores/agentStore";

// Palette — matches DiscussionPanel light theme
const COLORS = {
  surfacePanel:   "#FAF8F5",
  surfaceCardBg:  "#FFFFFF",
  surfaceInputBg: "#F5F0EB",
  border:         "#D4CFC9",
  borderHover:    "#B0ABA5",
  textPrimary:    "#1A1A1A",
  textBody:       "#5A5A5A",
  textMuted:      "#8A8A8A",
  accent:         "#B8D4E3",
  accentSoft:     "#E8F1F6",
  warning:        "#FFB800",
  warningBg:      "#FFF4DB",
  warningText:    "#9E6B00",
  codeBg:         "#1E1E1E",
};

// Dark code theme (VS Code dark+)
const CODE_THEME: { [key: string]: React.CSSProperties } = {
  'code, pre': { backgroundColor: COLORS.codeBg, color: "#D4D4D4" },
  comment: { color: "#6A9955" },
  keyword: { color: "#569CD6" },
  string: { color: "#CE9178" },
  number: { color: "#B5CEA8" },
  function: { color: "#DCDCAA" },
  variable: { color: "#9CDCFE" },
  type: { color: "#4EC9B0" },
  operator: { color: "#D4D4D4" },
  punctuation: { color: "#808080" },
};

// Language display names
const LANG_LABELS: Record<string, string> = {
  js: "JS", ts: "TS", tsx: "TSX", jsx: "JSX",
  py: "Python", python: "Python", rust: "Rust", rs: "Rust",
  go: "Go", bash: "Bash", sh: "Shell", zsh: "Zsh",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
  css: "CSS", html: "HTML", xml: "XML", sql: "SQL",
  md: "MD", mdx: "MDX", text: "Text", txt: "Text",
  "": "Code",
};

function langLabel(raw: string): string {
  return (LANG_LABELS[raw.toLowerCase()] ?? raw) || "Code";
}

// ===== Artifact types =====

/** A flattened code artifact for display in the drawer */
export interface Artifact {
  id: string;           // unique within discussion: "${msgId}-${blockIdx}"
  msgId: string;
  authorName: string;
  round: number;
  blockIdx: number;
  lang: string;
  content: string;
  /** Draft = not yet confirmed; Pin = confirmed worth keeping */
  status: "draft" | "pinned";
}

// Extract all artifacts from discussion messages
export function extractArtifacts(messages: DiscussionMessage[]): Artifact[] {
  const artifacts: Artifact[] = [];
  for (const msg of messages) {
    if (!msg.codeBlocks) continue;
    msg.codeBlocks.forEach((block, blockIdx) => {
      artifacts.push({
        id: `${msg.id}-${blockIdx}`,
        msgId: msg.id,
        authorName: msg.authorName,
        round: msg.round,
        blockIdx,
        lang: block.lang,
        content: block.content,
        status: "draft",
      });
    });
  }
  return artifacts;
}

// ===== Icon components =====

const IconX: FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12"/>
  </svg>
);
const IconChevronUp: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m18 15-6-6-6 6"/>
  </svg>
);
const IconPin: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="17" x2="12" y2="22"/>
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/>
  </svg>
);
const IconCopy: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const IconCheck: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);

// ===== ArtifactListItem =====

interface ArtifactListItemProps {
  artifact: Artifact;
  selected: boolean;
  onClick: () => void;
  onTogglePin: () => void;
}

const ArtifactListItem: FC<ArtifactListItemProps> = ({ artifact, selected, onClick, onTogglePin }) => {
  const isPinned = artifact.status === "pinned";
  const preview = artifact.content.split("\n").slice(0, 2).join("\n");
  const label = langLabel(artifact.lang);

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        background: selected ? COLORS.accentSoft : COLORS.surfaceCardBg,
        border: selected ? `2px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 700,
            color: isPinned ? COLORS.warningText : COLORS.textMuted,
            background: isPinned ? COLORS.warningBg : "rgba(0,0,0,0.05)",
            borderRadius: 4,
            padding: "1px 5px",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 10,
            fontWeight: 600,
            color: COLORS.textMuted,
          }}
        >
          R{artifact.round}
        </span>
        <span
          style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 10,
            color: COLORS.textMuted,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {artifact.authorName}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          title={isPinned ? "Unpin" : "Pin"}
          style={{
            display: "flex",
            alignItems: "center",
            padding: 3,
            borderRadius: 4,
            background: isPinned ? COLORS.warningBg : "transparent",
            border: "none",
            color: isPinned ? COLORS.warningText : COLORS.textMuted,
            cursor: "pointer",
            transition: "all 0.12s ease",
          }}
        >
          <IconPin size={12} />
        </button>
      </div>
      <pre
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          color: COLORS.textBody,
          margin: 0,
          padding: "3px 0 0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "pre",
          lineHeight: 1.4,
        }}
      >
        {preview}
      </pre>
    </button>
  );
};

// ===== Preview pane =====

const PreviewPane: FC<{ artifact: Artifact; onCopy: () => void; copied: boolean }> = ({ artifact, onCopy, copied }) => (
  <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
    {/* Preview header */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderBottom: `1px solid ${COLORS.border}`,
        background: COLORS.surfaceCardBg,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          fontWeight: 700,
          color: COLORS.textMuted,
        }}
      >
        {langLabel(artifact.lang)}
      </span>
      <span style={{ fontFamily: "'Geist Sans', sans-serif", fontSize: 10, color: COLORS.textMuted }}>
        {artifact.authorName} · Round {artifact.round}
      </span>
      <div style={{ flex: 1 }} />
      <button
        onClick={onCopy}
        title={copied ? "Copied!" : "Copy to clipboard"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 6,
          background: copied ? COLORS.accentSoft : COLORS.surfaceInputBg,
          border: `1px solid ${copied ? COLORS.accent : COLORS.border}`,
          color: copied ? COLORS.textPrimary : COLORS.textBody,
          cursor: "pointer",
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11,
          fontWeight: 600,
          transition: "all 0.15s ease",
        }}
      >
        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        <span>{copied ? "Copied!" : "Copy"}</span>
      </button>
    </div>

    {/* Code content */}
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: COLORS.codeBg,
      }}
    >
      <SyntaxHighlighter
        language={artifact.lang || "text"}
        style={CODE_THEME}
        customStyle={{
          margin: 0,
          padding: "14px 16px",
          background: "transparent",
          fontSize: 12,
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          lineHeight: 1.6,
        }}
        wrapLongLines={true}
        showLineNumbers={true}
        lineNumberStyle={{
          color: "#4A4A4A",
          minWidth: "2.5em",
          paddingRight: "1em",
          userSelect: "none",
        }}
      >
        {artifact.content}
      </SyntaxHighlighter>
    </div>
  </div>
);

// ===== Main ArtifactsDrawer =====

interface ArtifactsDrawerProps {
  messages: DiscussionMessage[];
  onClose: () => void;
}

const ArtifactsDrawer: FC<ArtifactsDrawerProps> = ({ messages, onClose }) => {
  const allArtifacts = extractArtifacts(messages);
  const pinned = allArtifacts.filter((a) => a.status === "pinned");

  // Local status map
  const [statuses, setStatuses] = useState<Record<string, "draft" | "pinned">>(() => {
    const init: Record<string, "draft" | "pinned"> = {};
    for (const a of allArtifacts) init[a.id] = a.status;
    return init;
  });

  const artifacts = allArtifacts.map((a) => ({ ...a, status: statuses[a.id] ?? a.status }));

  const [selectedId, setSelectedId] = useState<string | null>(
    artifacts.length > 0 ? artifacts[0].id : null,
  );

  const selectedArtifact = artifacts.find((a) => a.id === selectedId) ?? null;

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!selectedArtifact) return;
    try {
      await navigator.clipboard.writeText(selectedArtifact.content);
    } catch {
      const el = document.createElement("textarea");
      el.value = selectedArtifact.content;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [selectedArtifact]);

  const togglePin = useCallback((id: string) => {
    setStatuses((prev) => ({
      ...prev,
      [id]: prev[id] === "pinned" ? "draft" : "pinned",
    }));
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: 320,
        background: COLORS.surfacePanel,
        borderTop: `1px solid ${COLORS.border}`,
        flexShrink: 0,
      }}
    >
      {/* Drawer header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 16px",
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.surfaceCardBg,
          flexShrink: 0,
        }}
      >
        <IconChevronUp size={14} style={{ color: COLORS.textMuted }} />
        <span
          style={{
            fontFamily: "'Fraunces Variable', Georgia, serif",
            fontSize: 14,
            fontWeight: 700,
            color: COLORS.textPrimary,
          }}
        >
          Artifacts
        </span>
        <span
          style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11,
            color: COLORS.textMuted,
          }}
        >
          {allArtifacts.length} code block{allArtifacts.length !== 1 ? "s" : ""}
          {pinned.length > 0 && ` · ${pinned.length} pinned`}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            display: "flex",
            alignItems: "center",
            padding: 4,
            borderRadius: 6,
            background: "transparent",
            border: "none",
            color: COLORS.textMuted,
            cursor: "pointer",
          }}
          title="Close artifacts drawer"
        >
          <IconX size={14} />
        </button>
      </div>

      {/* Content */}
      {allArtifacts.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            gap: 8,
            color: COLORS.textMuted,
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 12,
          }}
        >
          <span>No code blocks yet — agents will generate artifacts as they discuss.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Artifact list */}
          <div
            style={{
              width: 200,
              flexShrink: 0,
              overflowY: "auto",
              padding: "8px 8px 8px 10px",
              borderRight: `1px solid ${COLORS.border}`,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {artifacts.map((a) => (
              <ArtifactListItem
                key={a.id}
                artifact={a}
                selected={a.id === selectedId}
                onClick={() => setSelectedId(a.id)}
                onTogglePin={() => togglePin(a.id)}
              />
            ))}
          </div>

          {/* Preview pane */}
          {selectedArtifact ? (
            <PreviewPane
              artifact={selectedArtifact}
              onCopy={handleCopy}
              copied={copied}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: COLORS.textMuted,
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 12,
              }}
            >
              Select an artifact to preview
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export { ArtifactsDrawer };
