// ===== AgentTreeView Component =====
// Renders a recursive tree view of the agent hierarchy
// Each node shows a status indicator dot + name + status text

import type { AgentTree, AgentStatus } from "@/types";

// ===== Props =====

interface AgentTreeViewProps {
  /** The agent tree structure to render */
  tree: AgentTree;
}

// ===== Status Color Mapping =====

function statusDotColor(status: AgentStatus): string {
  switch (status) {
    case "idle":
      return "bg-[#6B7280]";
    case "thinking":
      return "bg-[#e5c07b]";
    case "coding":
      return "bg-[#98c379]";
    case "waiting_permission":
      return "bg-[#e5c07b] animate-pulse";
    case "done":
      return "bg-accent";
    case "error":
      return "bg-[#e06c75]";
  }
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case "idle":
      return "idle";
    case "thinking":
      return "thinking";
    case "coding":
      return "coding";
    case "waiting_permission":
      return "waiting";
    case "done":
      return "done";
    case "error":
      return "error";
  }
}

// ===== Tree Node =====

function TreeNode({
  tree,
  depth,
}: {
  tree: AgentTree;
  depth: number;
}) {
  const { root, children } = tree;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-surface-dark-tertiary/50 transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Status dot */}
        <span
          className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDotColor(root.status)}`}
        />
        {/* Name */}
        <span className="text-[#F2F2F2] text-xs font-body truncate">
          {root.name}
        </span>
        {/* Status text */}
        <span className="text-[#6B7280] text-[10px] font-body ml-auto shrink-0">
          {statusLabel(root.status)}
        </span>
      </div>
      {/* Recursive children */}
      {children.map((child) => (
        <TreeNode key={child.root.id} tree={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ===== Main Component =====

export function AgentTreeView({ tree }: AgentTreeViewProps) {
  return (
    <div className="py-1 select-text">
      <TreeNode tree={tree} depth={0} />
    </div>
  );
}
