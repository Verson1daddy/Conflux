// ===== subagent 树（aware-header 下方，M3-ext-2 F1 §3，深 agent 观测 v2）=====
//
// 「会感知的终端」深一层：渲染当前 active 会话**真实观测到的**子 agent 派发树。
// 数据源：claude.ts extractSubagents（strippedBuffer 16KB 窗口内的派发行 + 折叠状态）。
//
// 诚实铁律（§0 + 持久化扩展 2026-06-19）：
//   - subagents.length === 0 → 渲染 null（诚实空，不留假占位行）。
//   - 只渲染真观测到的派发行（会话级累计）；status / detail 取折叠行字面，解析不到不编造。
//   - historic（已滚出当前窗口）→ 降透明 + 去 live 脉冲 + tooltip，不让过去时谎称实时。
//   - 扁平一层（claude 实渲 main→subagents 一层）；root 行仅作视觉锚，非伪造数据。
//
// 风格：mono、faint 基调、accent 仅状态点；与 AwareHeader 同度量（全走 --cx-* 变量）。
//   live running → 柔和脉冲点（复用 index.css .cx-dot-attention，自带 reduced-motion fallback）。
//   done / historic → 静态点（historic 整行 opacity 0.5）+ detail（剥 "Done (" 壳，剥不动显原文）。
// data-testid：conmux-subagent-tree（容器）、conmux-subagent-row（每行，带 data-type/data-status）。

import type { FC } from "react";
import { useSyncExternalStore } from "react";
import type { SubagentNode } from "../observe/types";
import type { SessionObserver } from "../observe/session-observer";

const MONO = "'JetBrains Mono', 'JetBrains Mono Variable', monospace";

const DOT_SIZE = 7;

/** 从 done 折叠行原文剥 "Done (" 壳 → 内层度量文本；剥不动显原文（诚实）。 */
function stripDoneShell(detail: string | null): string | null {
  if (detail === null) return null;
  // "Done (1 tool use · 18.9k tokens · 16s)" → "1 tool use · 18.9k tokens · 16s"
  const m = /Done\s*\(([^)]*)\)/i.exec(detail);
  if (m) return m[1].trim();
  return detail;
}

const SubagentRow: FC<{ node: SubagentNode }> = ({ node }) => {
  const isDone = node.status === "done";
  const isHistoric = node.historic === true;
  // live 脉冲只给"当前窗口内的 running"；done 或 historic 一律静态点（过去时不跳）。
  const pulse = !isDone && !isHistoric;
  const detailText = stripDoneShell(node.detail);
  return (
    <div
      data-testid="conmux-subagent-row"
      data-type={node.type}
      data-status={node.status}
      data-historic={isHistoric ? "true" : "false"}
      title={isHistoric ? "已滚出当前窗口 · 末次观测（非实时）" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontFamily: MONO,
        fontSize: 11,
        lineHeight: 1.4,
        color: "var(--cx-text-content)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        // historic = 已滚出窗口的过去时观测 → 降透明，与 live 行区分。
        opacity: isHistoric ? 0.5 : 1,
      }}
    >
      {/* 树枝符（视觉锚，扁平一层）。 */}
      <span style={{ flex: "0 0 auto", color: "var(--cx-text-faint)" }}>
        └
      </span>
      {/* 状态点：live running 脉冲（accent）；done / historic 静态（柔和）。 */}
      <span
        className={pulse ? "cx-dot cx-dot-attention" : "cx-dot"}
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: "50%",
          flex: "0 0 auto",
          background: pulse
            ? "var(--cx-status-attention)"
            : "var(--cx-status-idle)",
        }}
      />
      {/* type · description。 */}
      <span style={{ flex: "0 0 auto", color: "var(--cx-text-content)" }}>
        {node.type}
      </span>
      <span style={{ color: "var(--cx-text-muted)" }}>·</span>
      <span
        title={node.description}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: "var(--cx-text-muted)",
        }}
      >
        {node.description}
      </span>
      {/* 尾部状态：running → "running"；done → detail（度量）。 */}
      <span
        style={{
          flex: "0 0 auto",
          color: "var(--cx-text-faint)",
          letterSpacing: 0.3,
        }}
      >
        {isDone ? detailText ?? "done" : "running"}
      </span>
    </div>
  );
};

/**
 * subagent 树：订阅同一 observer（useSyncExternalStore），读 s.subagents。
 * 空 → null（诚实空，不占位）；非空 → 表头 `agents` + 扁平子行。
 * 颜色全走 chrome CSS 变量；状态/detail 全来自真实观测（不编造）。
 */
export const SubagentTree: FC<{ observer: SessionObserver }> = ({
  observer,
}) => {
  const s = useSyncExternalStore(observer.subscribe, observer.getSnapshot);
  const subagents = s.subagents;

  // 诚实空：当前无可观测子 agent → 不渲染（不留假占位行）。
  if (subagents.length === 0) return null;

  return (
    <div
      data-testid="conmux-subagent-tree"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flex: "0 0 auto",
        padding: "8px 16px",
        background: "var(--cx-surface-raised)",
        borderBottom: "1px solid var(--cx-line-hairline)",
        boxSizing: "border-box",
      }}
    >
      {/* 表头（root 锚）。 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: 0.5,
          color: "var(--cx-text-faint)",
          textTransform: "uppercase",
        }}
      >
        <span>agents</span>
        <span style={{ color: "var(--cx-text-muted)" }}>
          ({subagents.length})
        </span>
      </div>
      {subagents.map((node, i) => (
        <SubagentRow key={`${node.type}-${node.description}-${i}`} node={node} />
      ))}
    </div>
  );
};
