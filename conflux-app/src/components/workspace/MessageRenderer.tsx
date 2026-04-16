// ===== MessageRenderer — Markdown + Syntax Highlighting =====
// Renders a discussion message body as Markdown (GitHub Flavored) with
// fenced code blocks syntax-highlighted via react-syntax-highlighter.
//
// Uses a single-column layout: plain text as prose, code blocks as standalone
// blocks with a header row (language label + copy button) and highlighted code.

import { type FC, type ComponentPropsWithoutRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import type { CodeBlock } from "@/types/discussion";

// Palette matches DiscussionPanel.tsx light theme
const COLORS = {
  surfacePanel:   "#FAF8F5",
  surfaceCardBg:  "#FFFFFF",
  border:         "#D4CFC9",
  borderHover:    "#B0ABA5",
  textPrimary:    "#1A1A1A",
  textBody:       "#5A5A5A",
  textMuted:      "#8A8A8A",
  accent:         "#B8D4E3",
  codeBg:         "#1E1E1E",
  codeHeaderBg:   "#2A2A2A",
};

// Custom dark theme matching VS Code dark+ (matches workspace terminal)
const CODE_THEME: { [key: string]: React.CSSProperties } = {
  'code, pre': {
    backgroundColor: COLORS.codeBg,
    color: "#D4D4D4",
  },
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
  js: "JavaScript",
  ts: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  py: "Python",
  python: "Python",
  rust: "Rust",
  rs: "Rust",
  go: "Go",
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  zsh: "Zsh",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  css: "CSS",
  html: "HTML",
  xml: "XML",
  sql: "SQL",
  md: "Markdown",
  mdx: "MDX",
  dockerfile: "Dockerfile",
  tf: "Terraform",
  hcl: "HCL",
  vim: "Vim",
  lua: "Lua",
  ruby: "Ruby",
  rb: "Ruby",
  java: "Java",
  c: "C",
  cpp: "C++",
  cs: "C#",
  swift: "Swift",
  kt: "Kotlin",
  scala: "Scala",
  r: "R",
  dart: "Dart",
  elixir: "Elixir",
  ex: "Elixir",
  erlang: "Erlang",
  exs: "Elixir",
  php: "PHP",
  pl: "Perl",
  perl: "Perl",
  hs: "Haskell",
  hs2: "Haskell",
  ml: "OCaml",
  elm: "Elm",
  fsharp: "F#",
  fs: "F#",
  purescript: "PureScript",
  puresc: "PureScript",
  solidity: "Solidity",
  sol: "Solidity",
  move: "Move",
  acl2: "ACL2",
  lean: "Lean",
  coq: "Coq",
  agda: "Agda",
  idris: "Idris",
  text: "Text",
  txt: "Text",
  plain: "Plain text",
  "": "Code",
};

function langLabel(raw: string): string {
  return (LANG_LABELS[raw.toLowerCase()] ?? raw) || "Code";
}

// ===== Copy-to-clipboard button =====

const IconCopy: FC<{ size?: number }> = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const IconCheck: FC<{ size?: number }> = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);

const CopyButton: FC<{ text: string }> = ({ text }) => {
  // Stable copy state stored on window to persist across re-renders of parent
  const win = window as unknown as Record<string, Record<number, boolean>>;
  if (!win.__copyState__) win.__copyState__ = {};
  const copyState = win.__copyState__;
  const key = text.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  // Re-render trigger
  const [, forceRender] = useState(0);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    copyState[key] = true;
    forceRender((n) => n + 1);
    setTimeout(() => {
      copyState[key] = false;
      forceRender((n) => n + 1);
    }, 2000);
  };

  return (
    <button
      onClick={handleCopy}
      title={copyState[key] ? "Copied!" : "Copy code"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.15)",
        color: copyState[key] ? "#4EC9B0" : "#AAAAAA",
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "'Geist Sans', sans-serif",
        fontWeight: 600,
        transition: "all 0.15s ease",
        minWidth: 70,
        justifyContent: "center",
      }}
    >
      {copyState[key] ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span>{copyState[key] ? "Copied" : "Copy"}</span>
    </button>
  );
};

// ===== Code block renderer =====

const CodeBlockView: FC<{ block: CodeBlock }> = ({ block }) => {
  const lang = block.lang || "";
  const label = langLabel(lang);

  return (
    <div
      style={{
        borderRadius: 10,
        overflow: "hidden",
        border: `1px solid rgba(255,255,255,0.12)`,
        marginTop: 6,
        marginBottom: 6,
      }}
    >
      {/* Header: language label + copy button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 14px",
          background: COLORS.codeHeaderBg,
          borderBottom: `1px solid rgba(255,255,255,0.08)`,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 600,
            color: "#808080",
            letterSpacing: 0.3,
          }}
        >
          {label}
        </span>
        <CopyButton text={block.content} />
      </div>

      {/* Code */}
      <SyntaxHighlighter
        language={lang || "text"}
        style={CODE_THEME}
        customStyle={{
          margin: 0,
          padding: "14px 16px",
          background: COLORS.codeBg,
          fontSize: 12,
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          lineHeight: 1.6,
          borderRadius: 0,
        }}
        wrapLongLines={false}
        showLineNumbers={false}
      >
        {block.content}
      </SyntaxHighlighter>
    </div>
  );
};

// ===== Inline code styles =====

const InlineCode: FC<{ children: React.ReactNode }> = ({ children }) => (
  <code
    style={{
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      fontSize: "0.875em",
      background: "rgba(0,0,0,0.06)",
      border: "1px solid rgba(0,0,0,0.10)",
      borderRadius: 4,
      padding: "1px 5px",
      color: COLORS.textPrimary,
    }}
  >
    {children}
  </code>
);

// ===== Message body renderer =====
// Splits the body into segments: code blocks (highlighted) and non-code
// (rendered as Markdown). Code blocks use CodeBlockView; text uses
// ReactMarkdown with remarkGfm.

function MessageBody({ body, codeBlocks }: { body: string; codeBlocks: CodeBlock[] | null }) {
  // If no code blocks, render entire body as markdown
  if (!codeBlocks || codeBlocks.length === 0) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children }: ComponentPropsWithoutRef<'code'>) {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1] : "";
            const code = String(children).replace(/\n$/, "");
            if (lang) {
              return (
                <CodeBlockView
                  block={{ lang, content: code, startOffset: 0, endOffset: 0 }}
                />
              );
            }
            return <InlineCode>{children}</InlineCode>;
          },
          pre({ children }: ComponentPropsWithoutRef<'pre'>) {
            // Let the code component handle it
            return <>{children}</>;
          },
        }}
      >
        {body}
      </ReactMarkdown>
    );
  }

  // Split body into segments
  const segments: Array<{ type: "text"; content: string } | { type: "code"; block: CodeBlock }> = [];
  let lastIndex = 0;

  // Sort blocks by startOffset
  const sorted = [...codeBlocks].sort((a, b) => a.startOffset - b.startOffset);

  for (const block of sorted) {
    if (block.startOffset > lastIndex) {
      segments.push({ type: "text", content: body.slice(lastIndex, block.startOffset) });
    }
    segments.push({ type: "code", block });
    lastIndex = block.endOffset;
  }

  if (lastIndex < body.length) {
    segments.push({ type: "text", content: body.slice(lastIndex) });
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <CodeBlockView key={i} block={seg.block} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children }: ComponentPropsWithoutRef<'code'>) {
                const match = /language-(\w+)/.exec(className || "");
                if (match) {
                  const code = String(children).replace(/\n$/, "");
                  return (
                    <CodeBlockView
                      block={{ lang: match[1], content: code, startOffset: 0, endOffset: 0 }}
                    />
                  );
                }
                return <InlineCode>{children}</InlineCode>;
              },
              pre({ children }: ComponentPropsWithoutRef<'pre'>) {
                return <>{children}</>;
              },
            }}
          >
            {seg.content}
          </ReactMarkdown>
        ),
      )}
    </>
  );
}

// ===== Main export =====

interface MessageRendererProps {
  body: string;
  codeBlocks: CodeBlock[] | null;
}

const MessageRenderer: FC<MessageRendererProps> = ({ body, codeBlocks }) => {
  return (
    <div
      style={{
        fontFamily: "'Geist Sans', sans-serif",
        fontSize: 13,
        lineHeight: 1.55,
        color: COLORS.textBody,
      }}
    >
      <MessageBody body={body} codeBlocks={codeBlocks} />
    </div>
  );
};

export { MessageRenderer };
export type { MessageRendererProps };
