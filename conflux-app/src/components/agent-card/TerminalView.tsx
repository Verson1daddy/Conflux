// ===== TerminalView Component =====
// Pure React terminal output view (no xterm.js dependency)
// Displays PTY output lines with ANSI 8-color support, auto-scroll, and text selection

import { useEffect, useRef } from "react";
import { useEventStream } from "@/hooks/useEventStream";

// ===== Props =====

interface TerminalViewProps {
  /** The agent instance to display PTY output for */
  instanceId: string;
}

// ===== ANSI Color Mapping (8 colors) =====

const ANSI_COLORS: Record<number, string> = {
  30: "#282c34", // black
  31: "#e06c75", // red
  32: "#98c379", // green
  33: "#e5c07b", // yellow
  34: "#61afef", // blue
  35: "#c678dd", // purple
  36: "#56b6c2", // cyan
  37: "#abb2bf", // white
};

// ===== ANSI Segment Type =====

interface AnsiSegment {
  text: string;
  color: string | null;
  bold: boolean;
}

/**
 * Parse a single line into styled segments based on ANSI escape codes.
 * Supports: \x1b[0m (reset), \x1b[1m (bold), \x1b[30-37m (foreground colors)
 */
function parseAnsiLine(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  // Match ANSI escape sequences: ESC[...m
  const ansiRegex = /\x1b\[([0-9;]*)m/g;

  let currentColor: string | null = null;
  let currentBold = false;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(line)) !== null) {
    // Push text before this escape code
    if (match.index > lastIndex) {
      segments.push({
        text: line.slice(lastIndex, match.index),
        color: currentColor,
        bold: currentBold,
      });
    }

    // Parse the escape code parameter(s)
    const params = match[1].split(";").map(Number);
    for (const code of params) {
      if (code === 0) {
        // Reset
        currentColor = null;
        currentBold = false;
      } else if (code === 1) {
        // Bold
        currentBold = true;
      } else if (code >= 30 && code <= 37) {
        // Foreground color
        currentColor = ANSI_COLORS[code] ?? null;
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text after last escape code
  if (lastIndex < line.length) {
    segments.push({
      text: line.slice(lastIndex),
      color: currentColor,
      bold: currentBold,
    });
  }

  // If no segments produced (empty line or no text), push empty segment
  if (segments.length === 0) {
    segments.push({ text: "", color: null, bold: false });
  }

  return segments;
}

// ===== Terminal Line Renderer =====

function TerminalLine({ line }: { line: string }) {
  const segments = parseAnsiLine(line);

  return (
    <div className="leading-[1.5]">
      {segments.map((seg, i) => {
        if (seg.text.length === 0 && segments.length === 1) {
          // Empty line — render a non-breaking space to preserve height
          return <span key={i}>{"\u00A0"}</span>;
        }
        return (
          <span
            key={i}
            style={{
              color: seg.color ?? undefined,
              fontWeight: seg.bold ? 700 : undefined,
            }}
          >
            {seg.text}
          </span>
        );
      })}
    </div>
  );
}

// ===== Main Component =====

export function TerminalView({ instanceId }: TerminalViewProps) {
  const { lines, isStreaming } = useEventStream(instanceId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-surface-dark overflow-y-auto select-text p-3"
    >
      <div className="font-mono text-[13px] text-[#abb2bf]">
        {lines.length === 0 && !isStreaming && (
          <div className="text-[#6B7280] italic">
            Waiting for output...
          </div>
        )}
        {lines.map((line, idx) => (
          <TerminalLine key={idx} line={line} />
        ))}
        {/* Scroll anchor */}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
