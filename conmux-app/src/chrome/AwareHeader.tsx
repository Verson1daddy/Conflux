// ===== aware-header（缩点条与 pane 之间，M3-ext F1 契约 §1 / .pen XK1nU）=====
//
// 「会感知的终端」头条：显示可**诚实观测**的会话运行信息（B1）+ LLM 元数据（B6）。
// 拿不到的字段一律显 `—`（绝不伪造，§0 铁律）。
//
// .pen XK1nU 视觉契约：fill surface.raised · padding [10,16] · 底发丝线 1px · gap 7。
//   B1（8g1rN）：状态点(status.*) + 「{活动 ?? 泛化} · {耗时} · {cwd ?? —}」JetBrains Mono 12 text.content
//   B6（4ai9a）：ctx 标签(text.muted) + 进度条(contextPct) + {pct% / —} · {model / —} ·
//                {tokens / —} · Σ↑/Σ↓（来自 JSONL 富观测，M⑥）
//   M⑥ 富观测（claude 会话）：cost slot 已退役（D-4，订阅边际≈$0 不显金额误导）；ctx/tokens/
//     model 由 JSONL 权威源喂真值；新增 activeWorkflow / recentSkill / Σ↑Σ↓ / skills 计数。
//   非 agent（shell）态：B6 整行淡化 + 标「非 agent 会话」（无 LLM 元数据可诚实展示）。
//
// 全走 chrome CSS 变量（--cx-*，M③ 已建）；零硬编色。

import type { FC } from "react";
import { useSyncExternalStore } from "react";
import type { AwareState, ObserveStatus } from "../observe/types";
import type { SessionObserver } from "../observe/session-observer";

const MONO =
  "'JetBrains Mono', 'JetBrains Mono Variable', monospace";

const STATUS_VAR: Record<ObserveStatus, string> = {
  running: "var(--cx-status-running)",
  idle: "var(--cx-status-idle)",
  exited: "var(--cx-status-warn)",
};

/** elapsedMs → 人读「Mm Ss」/「Ss」（诚实计算，无伪造）。 */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/** 状态泛化文案（无具体 activity 时，据 status 诚实泛化，不编具体活动）。 */
function genericActivity(status: ObserveStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "idle":
      return "空闲";
    case "exited":
      return "已退出";
  }
}

const DOT_SIZE = 8;

const B1Row: FC<{ s: AwareState }> = ({ s }) => {
  const activityText = s.activity ?? genericActivity(s.status);
  return (
    <div
      data-testid="aware-b1"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: MONO,
        fontSize: 12,
        lineHeight: 1.3,
        color: "var(--cx-text-content)",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span
        data-testid="aware-status-dot"
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: "50%",
          background: STATUS_VAR[s.status],
          flex: "0 0 auto",
        }}
      />
      <span style={{ flex: "0 0 auto" }}>{activityText}</span>
      <span style={{ color: "var(--cx-text-muted)" }}>·</span>
      <span data-testid="aware-elapsed" style={{ flex: "0 0 auto" }}>
        {formatElapsed(s.elapsedMs)}
      </span>
      <span style={{ color: "var(--cx-text-muted)" }}>·</span>
      <span
        data-testid="aware-cwd"
        title={s.cwd ?? undefined}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: s.cwd ? "var(--cx-text-content)" : "var(--cx-text-faint)",
        }}
      >
        {s.cwd ?? "—"}
      </span>
    </div>
  );
};

const EM_DASH = "—";

/** Σ tokens → 人读紧凑（12,345 → "12.3k"，<1000 原值）。 */
function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

const B6Row: FC<{ s: AwareState; skillCount: number | null }> = ({
  s,
  skillCount,
}) => {
  const isShell = !s.isAgent;
  const pctText = s.contextPct != null ? `${s.contextPct}%` : EM_DASH;
  const tokensText =
    s.tokensUsed != null
      ? s.tokensTotal != null
        ? `${s.tokensUsed.toLocaleString()}/${s.tokensTotal.toLocaleString()} tok`
        : `${s.tokensUsed.toLocaleString()} tok`
      : EM_DASH;
  // M⑥：cost slot 退役（D-4，订阅边际≈$0 不显金额误导）；改显 Σ↑/Σ↓ 会话累计（JSONL 真值）。
  const sessionText =
    s.sessionTokensIn != null && s.sessionTokensOut != null
      ? `Σ↑${formatCompact(s.sessionTokensIn)} ↓${formatCompact(s.sessionTokensOut)}`
      : EM_DASH;
  const barFill =
    s.contextPct != null ? Math.max(0, Math.min(100, s.contextPct)) : 0;

  return (
    <div
      data-testid="aware-b6"
      data-shell={isShell ? "true" : "false"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: MONO,
        fontSize: 11,
        lineHeight: 1.3,
        color: "var(--cx-text-muted)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        // 非 agent（shell）态：整行淡化（无 LLM 元数据可诚实展示）。
        opacity: isShell ? 0.45 : 1,
      }}
    >
      <span style={{ flex: "0 0 auto", letterSpacing: 0.5 }}>ctx</span>
      {/* 进度条（contextPct；null → 空条 + 旁显 —） */}
      <span
        data-testid="aware-ctx-bar"
        style={{
          flex: "0 0 auto",
          width: 64,
          height: 5,
          borderRadius: 3,
          background: "var(--cx-line-soft)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${barFill}%`,
            background: "var(--cx-status-running)",
            borderRadius: 3,
          }}
        />
      </span>
      <span data-testid="aware-ctx-pct" style={{ flex: "0 0 auto" }}>
        {pctText}
      </span>
      <span>·</span>
      <span data-testid="aware-model" style={{ flex: "0 0 auto" }}>
        {isShell ? "非 agent 会话" : (s.model ?? EM_DASH)}
      </span>
      <span>·</span>
      <span data-testid="aware-tokens" style={{ flex: "0 0 auto" }}>
        {tokensText}
      </span>
      <span>·</span>
      <span data-testid="aware-session" style={{ flex: "0 0 auto" }}>
        {sessionText}
      </span>
      {/* skills 计数（App 级 list_available_skills，已安装非已加载；null → 不渲染占位）。 */}
      {!isShell && skillCount != null && (
        <>
          <span>·</span>
          <span data-testid="conmux-skills-count" style={{ flex: "0 0 auto" }}>
            skills: {skillCount}
          </span>
        </>
      )}
    </div>
  );
};

/**
 * B7 行（M⑥ 富观测）：activeWorkflow / recentSkill。仅 agent 且至少一项有值时渲染
 * （否则不占位）。诚实文案：workflow 标「运行中」、skill 标「最近」（D-6，非伪 live）。
 */
const B7Row: FC<{ s: AwareState }> = ({ s }) => {
  if (s.isAgent !== true) return null;
  if (s.activeWorkflow == null && s.recentSkill == null) return null;
  return (
    <div
      data-testid="aware-b7"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: MONO,
        fontSize: 11,
        lineHeight: 1.3,
        color: "var(--cx-text-muted)",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      {s.activeWorkflow != null && (
        <span data-testid="aware-workflow" style={{ flex: "0 0 auto" }}>
          ⚙ {s.activeWorkflow}（运行中）
        </span>
      )}
      {s.activeWorkflow != null && s.recentSkill != null && <span>·</span>}
      {s.recentSkill != null && (
        <span data-testid="aware-skill" style={{ flex: "0 0 auto" }}>
          ◆ {s.recentSkill}（最近）
        </span>
      )}
    </div>
  );
};

/**
 * aware-header：订阅 observer（useSyncExternalStore），渲染 B1 + B6 + B7（M⑥）。
 * 颜色全走 chrome CSS 变量；拿不到的字段显 `—`（诚实）。
 * skillCount = App 级 list_available_skills 计数（null = 未拉到 / 拉取中 → 不渲染）。
 */
export const AwareHeader: FC<{
  observer: SessionObserver;
  skillCount?: number | null;
}> = ({ observer, skillCount = null }) => {
  const s = useSyncExternalStore(observer.subscribe, observer.getSnapshot);
  return (
    <div
      data-testid="conmux-aware-header"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        flex: "0 0 auto",
        padding: "10px 16px",
        background: "var(--cx-surface-raised)",
        borderBottom: "1px solid var(--cx-line-hairline)",
        boxSizing: "border-box",
      }}
    >
      <B1Row s={s} />
      <B6Row s={s} skillCount={skillCount} />
      <B7Row s={s} />
    </div>
  );
};
