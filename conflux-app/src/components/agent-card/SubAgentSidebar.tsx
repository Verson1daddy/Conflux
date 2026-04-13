// ===== SubAgentSidebar Component =====
// Left sidebar in the expanded agent card view
// Shows adapter name, sub-agent list with status dots, and AgentTreeView toggle

import { useState, useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentStatus, AgentTree, SubAgentInfo } from "@/types";

// ===== Inline AgentTreeView (formerly in AgentTreeView.tsx) =====

function treeStatusDotColor(status: AgentStatus): string {
  switch (status) {
    case "idle":               return "bg-[#6B7280]";
    case "thinking":           return "bg-[#e5c07b]";
    case "coding":             return "bg-[#98c379]";
    case "waiting_permission": return "bg-[#e5c07b] animate-pulse";
    case "done":               return "bg-accent";
    case "error":              return "bg-[#e06c75]";
  }
}

function treeStatusLabel(status: AgentStatus): string {
  switch (status) {
    case "idle":               return "idle";
    case "thinking":           return "thinking";
    case "coding":             return "coding";
    case "waiting_permission": return "waiting";
    case "done":               return "done";
    case "error":              return "error";
  }
}

function TreeNode({ tree, depth }: { tree: AgentTree; depth: number }) {
  const { root, children } = tree;
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-surface-dark-tertiary/50 transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${treeStatusDotColor(root.status)}`} />
        <span className="text-[#F2F2F2] text-xs font-body truncate">{root.name}</span>
        <span className="text-[#6B7280] text-[10px] font-body ml-auto shrink-0">{treeStatusLabel(root.status)}</span>
      </div>
      {children.map((child) => (
        <TreeNode key={child.root.id} tree={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function AgentTreeView({ tree }: { tree: AgentTree }) {
  return (
    <div className="py-1 select-text">
      <TreeNode tree={tree} depth={0} />
    </div>
  );
}

// ===== Props =====

interface SubAgentSidebarProps {
  /** The agent instance this sidebar belongs to */
  instanceId: string;
  /** The adapter/framework display name */
  adapterName: string;
}

// ===== Status Dot Color =====

function statusDotClass(status: AgentStatus): string {
  switch (status) {
    case "idle":
      return "bg-[#6B7280]";
    case "thinking":
      return "bg-[#e5c07b] animate-pulse";
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

// ===== Flatten tree to get all sub-agents =====

function collectSubAgents(tree: AgentTree): SubAgentInfo[] {
  const result: SubAgentInfo[] = [];
  for (const child of tree.children) {
    result.push(child.root);
    result.push(...collectSubAgents(child));
  }
  return result;
}

// ===== Main Component =====

export function SubAgentSidebar({
  instanceId,
  adapterName,
}: SubAgentSidebarProps) {
  const [showTree, setShowTree] = useState(false);
  const tree = useAgentStore((s) => s.trees.get(instanceId));

  // Flatten sub-agents for the list view
  const subAgents = useMemo(() => {
    if (!tree) return [];
    return collectSubAgents(tree);
  }, [tree]);

  return (
    <div className="w-[200px] shrink-0 bg-surface-dark-secondary flex flex-col border-r border-surface-dark-tertiary">
      {/* Header — adapter name */}
      <div className="h-10 flex items-center px-3 border-b border-surface-dark-tertiary">
        <span className="text-[#F2F2F2] text-xs font-body font-semibold truncate">
          {adapterName}
        </span>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {showTree && tree ? (
          /* Tree view */
          <AgentTreeView tree={tree} />
        ) : (
          /* Flat sub-agent list */
          <div className="py-1">
            {subAgents.length === 0 ? (
              <div className="px-3 py-2 text-[#6B7280] text-xs font-body italic">
                No sub-agents
              </div>
            ) : (
              subAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-dark-tertiary/50 transition-colors"
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDotClass(agent.status)}`}
                  />
                  <span className="text-[#F2F2F2] text-xs font-body truncate">
                    {agent.name}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer — tree toggle button */}
      {tree && (
        <div className="border-t border-surface-dark-tertiary px-3 py-2">
          <button
            type="button"
            onClick={() => setShowTree((prev) => !prev)}
            className="w-full text-[10px] font-body text-[#B8B3B0] hover:text-[#F2F2F2] transition-colors text-center py-1 rounded hover:bg-surface-dark-tertiary/50"
          >
            {showTree ? "Show List" : "Show Tree"}
          </button>
        </div>
      )}
    </div>
  );
}
