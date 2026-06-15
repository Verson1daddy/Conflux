// ===== Home 仪表盘（M⑤b F1 契约 §4，.pen 6Faub B 风格）=====
//
// 0 会话时替换 M④「无会话」兜底（D-2）：显 RECENT（最近关闭可重开）+ QUICK LAUNCH
// （用户注册的快捷启动项 chips，点→起为新会话，D-1）+ RUNNING（仅 sessions.length>0 渲，
// 0 会话 Home 时隐，D-6——避免常空段；有会话开 Home = M⑤c overview 才显）。
//
// 全走 --cx-* 变量随风格自适应（明暗皆可）。键盘：v1 先鼠标点 + `n`（新建默认会话）/
// `Ctrl+K`（命令面板，已全局）；↑↓+⏎ 完整键盘导航留 M⑤c。
//
// 数据：launch-registry（QUICK LAUNCH，store + subscribe）+ sessions store（RECENT / RUNNING）。
// RUNNING activity 来自各会话 observer 的 AwareState（由 App 经 props 注入；无则略）。

import {
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FC,
} from "react";
import {
  addEntry,
  getLaunchEntries,
  parseCommand,
  subscribeLaunchEntries,
  type LaunchEntry,
} from "../lib/launch-registry";
import {
  getRecent,
  getSessions,
  subscribeSessions,
  type RecentEntry,
} from "../lib/sessions";
import type { SessionStatus } from "./session-status";

const MONO = "'JetBrains Mono', 'JetBrains Mono Variable', monospace";
const SERIF = "'Fraunces', 'Fraunces Variable', Georgia, serif";

const STATUS_VAR: Record<SessionStatus, string> = {
  running: "var(--cx-status-running)",
  idle: "var(--cx-status-idle)",
  warn: "var(--cx-status-warn)",
  attention: "var(--cx-accent-signal)",
};

/** RUNNING 行数据（App 注入：每个会话名 + 状态 + 可选活动文案）。 */
export interface HomeRunningRow {
  instanceId: string;
  name: string;
  status: SessionStatus;
  /** 来自该会话 observer 的活动文案；null = 略（不编）。 */
  activity: string | null;
}

export interface HomeProps {
  /** 当前会话数（header 右上 "N 会话"）。 */
  sessionCount: number;
  /** daemon 连接态（header 右上 daemon ●）。 */
  daemonConnected: boolean;
  /** RUNNING 行（仅 sessions.length>0 才有；0 会话 Home 时为 []）。 */
  running: HomeRunningRow[];
  /** 新建默认会话（QUICK LAUNCH 无关的「n」/兜底入口）。 */
  onNewDefault: () => void;
  /** 点 QUICK LAUNCH chip → 起为新会话（D-1）。 */
  onLaunch: (entry: LaunchEntry) => void;
  /** 重开 RECENT 条目。 */
  onReopenRecent: (entry: RecentEntry) => void;
}

/** 段头（`── LABEL ──────…`，mono 12 faint）。 */
const SectionHeader: FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontFamily: MONO,
      fontSize: 12,
      letterSpacing: 1,
      color: "var(--cx-text-faint)",
      whiteSpace: "nowrap",
      userSelect: "none",
    }}
  >
    <span>──</span>
    <span>{label}</span>
    <span
      aria-hidden
      style={{
        flex: 1,
        height: 0,
        borderTop: "1px solid var(--cx-line-hairline)",
        opacity: 0.7,
      }}
    />
  </div>
);

/** 加项表单 input 共用样式（--cx-* 自适应）。 */
function addInputStyle(width: number): CSSProperties {
  return {
    width,
    maxWidth: "40vw",
    height: 28,
    padding: "0 10px",
    borderRadius: 6,
    border: "1px solid var(--cx-line-soft)",
    background: "var(--cx-surface-base)",
    color: "var(--cx-text-content)",
    fontFamily: MONO,
    fontSize: 12,
    outline: "none",
    boxSizing: "border-box",
  };
}

/** 相对时间（"Nm ago" / "Nh ago" / "now"）。closedAt 为 ms 时间戳。 */
function relTime(closedAt: number): string {
  const diff = Math.max(0, Date.now() - closedAt);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

const Home: FC<HomeProps> = ({
  sessionCount,
  daemonConnected,
  running,
  onNewDefault,
  onLaunch,
  onReopenRecent,
}) => {
  // 订阅注册表 + 会话 store（RECENT 随会话关闭变动 → 重渲）。
  const entries = useSyncExternalStore(subscribeLaunchEntries, getLaunchEntries);
  // RECENT 与 sessions 同 store（同一 notify 广播）。
  const recent = useSyncExternalStore(subscribeSessions, getRecent);
  // sessions 用于 RUNNING 段渲染判定（与 props.running 一致来源；订阅触发重渲）。
  const sessions = useSyncExternalStore(subscribeSessions, getSessions);
  const hasRunning = sessions.length > 0;

  // ＋加项内联表单（v1：name + command + cwd 可选；提交即写注册表，store 广播刷新 chips）。
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const [addCwd, setAddCwd] = useState("");

  const submitAdd = (): void => {
    const name = addName.trim();
    const command = addCommand.trim();
    if (name === "" || command === "") return; // 必填校验（诚实：不建空目标）。
    addEntry({ name, command, ...(addCwd.trim() ? { cwd: addCwd.trim() } : {}) });
    setAddName("");
    setAddCommand("");
    setAddCwd("");
    setAddOpen(false);
  };

  return (
    <div
      data-testid="conmux-home"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--cx-surface-base)",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* ===== header（conmux 字标 + HOME + 右 N 会话 · daemon ●）===== */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          padding: "16px 18px 8px 18px",
          flex: "0 0 auto",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: 20,
            fontWeight: 500,
            color: "var(--cx-accent-signal)",
            letterSpacing: 0.2,
          }}
        >
          conmux
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "var(--cx-text-muted)",
          }}
        >
          HOME
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: MONO,
            fontSize: 11,
            color: "var(--cx-text-muted)",
          }}
        >
          <span>{sessionCount} 会话</span>
          <span style={{ color: "var(--cx-text-faint)" }}>·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            daemon
            <span
              aria-label={daemonConnected ? "daemon 已连接" : "daemon 未连接"}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: daemonConnected
                  ? "var(--cx-status-running)"
                  : "var(--cx-text-faint)",
                display: "inline-block",
              }}
            />
          </span>
        </span>
      </div>

      {/* ===== body（vertical gap 9, padding [14,18], 可滚）===== */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          padding: "14px 18px",
          overflowY: "auto",
          boxSizing: "border-box",
        }}
      >
        {/* ── RECENT ── */}
        <section
          data-testid="conmux-home-recent"
          style={{ display: "flex", flexDirection: "column", gap: 9 }}
        >
          <SectionHeader label="RECENT" />
          {recent.length === 0 ? (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 12,
                color: "var(--cx-text-faint)",
                paddingLeft: 4,
              }}
            >
              无最近会话
            </div>
          ) : (
            recent.map((r, idx) => (
              <button
                key={`${r.command}|${r.cwd ?? ""}|${idx}`}
                type="button"
                data-testid="conmux-home-recent-item"
                data-recent-idx={idx}
                onClick={() => onReopenRecent(r)}
                title={`重开 ${r.name}（${r.command}）`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  width: "100%",
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: 6,
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  boxSizing: "border-box",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--cx-surface-chrome)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--cx-text-faint)",
                    flex: "0 0 auto",
                  }}
                />
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    color: "var(--cx-text-content)",
                    flex: "0 0 auto",
                  }}
                >
                  {r.name}
                </span>
                {r.cwd && (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: "var(--cx-text-faint)",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    · {r.cwd}
                  </span>
                )}
                <span style={{ flex: r.cwd ? "0 0 auto" : 1 }} />
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: "var(--cx-text-faint)",
                    flex: "0 0 auto",
                  }}
                >
                  {relTime(r.closedAt)}
                </span>
              </button>
            ))
          )}
        </section>

        {/* ── QUICK LAUNCH ── */}
        <section
          data-testid="conmux-home-quick"
          style={{ display: "flex", flexDirection: "column", gap: 9 }}
        >
          <SectionHeader label="QUICK LAUNCH" />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              paddingLeft: 4,
            }}
          >
            {entries.map((entry) => {
              const { program } = parseCommand(entry.command);
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-testid="conmux-home-quick-item"
                  data-entry-id={entry.id}
                  onClick={() => onLaunch(entry)}
                  title={`启动 ${entry.name}（${program || entry.command}）`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    height: 30,
                    padding: "0 12px",
                    borderRadius: 6,
                    border: "1px solid var(--cx-line-soft)",
                    background: "var(--cx-surface-raised)",
                    cursor: "pointer",
                    boxSizing: "border-box",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--cx-accent-signal)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--cx-line-soft)";
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 14,
                      lineHeight: 1,
                      color: "var(--cx-accent-signal)",
                      flex: "0 0 auto",
                    }}
                  >
                    ›
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      color: "var(--cx-text-content)",
                    }}
                  >
                    {entry.name}
                  </span>
                </button>
              );
            })}
            {/* ＋ 加项入口（toggle 内联表单） */}
            <button
              type="button"
              data-testid="conmux-home-add"
              aria-label="新增启动项"
              aria-expanded={addOpen}
              title="新增启动项"
              onClick={() => setAddOpen((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: 30,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px dashed var(--cx-line-soft)",
                background: addOpen ? "var(--cx-surface-chrome)" : "transparent",
                color: "var(--cx-text-muted)",
                fontFamily: MONO,
                fontSize: 13,
                cursor: "pointer",
                boxSizing: "border-box",
                whiteSpace: "nowrap",
              }}
            >
              {addOpen ? "× 取消" : "＋ 加项"}
            </button>
          </div>

          {/* 内联加项表单（name + command 必填 · cwd 可选；⏎ 提交、esc 取消）。 */}
          {addOpen && (
            <div
              data-testid="conmux-home-add-form"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                marginLeft: 4,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--cx-line-soft)",
                background: "var(--cx-surface-raised)",
                boxSizing: "border-box",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitAdd();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAddOpen(false);
                }
              }}
            >
              <input
                data-testid="conmux-home-add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="名称（如 claude）"
                spellCheck={false}
                autoComplete="off"
                style={addInputStyle(120)}
              />
              <input
                data-testid="conmux-home-add-command"
                value={addCommand}
                onChange={(e) => setAddCommand(e.target.value)}
                placeholder="命令（如 claude --resume）"
                spellCheck={false}
                autoComplete="off"
                style={addInputStyle(200)}
              />
              <input
                data-testid="conmux-home-add-cwd"
                value={addCwd}
                onChange={(e) => setAddCwd(e.target.value)}
                placeholder="工作目录（可选）"
                spellCheck={false}
                autoComplete="off"
                style={addInputStyle(160)}
              />
              <button
                type="button"
                data-testid="conmux-home-add-submit"
                onClick={submitAdd}
                disabled={addName.trim() === "" || addCommand.trim() === ""}
                style={{
                  height: 28,
                  padding: "0 14px",
                  borderRadius: 6,
                  border: "1px solid var(--cx-accent-signal)",
                  background: "transparent",
                  color: "var(--cx-accent-signal)",
                  fontFamily: MONO,
                  fontSize: 12,
                  cursor:
                    addName.trim() === "" || addCommand.trim() === ""
                      ? "default"
                      : "pointer",
                  opacity:
                    addName.trim() === "" || addCommand.trim() === "" ? 0.45 : 1,
                  boxSizing: "border-box",
                  whiteSpace: "nowrap",
                }}
              >
                添加
              </button>
            </div>
          )}
        </section>

        {/* ── RUNNING ──（仅 sessions.length>0 渲，0 会话 Home 时隐，D-6）== */}
        {hasRunning && (
          <section
            data-testid="conmux-home-running"
            style={{ display: "flex", flexDirection: "column", gap: 9 }}
          >
            <SectionHeader label="RUNNING" />
            {running.map((row) => (
              <div
                key={row.instanceId}
                data-testid="conmux-home-running-item"
                data-instance-id={row.instanceId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "4px 8px",
                  boxSizing: "border-box",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: STATUS_VAR[row.status],
                    flex: "0 0 auto",
                  }}
                />
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    color: "var(--cx-text-content)",
                    flex: "0 0 auto",
                  }}
                >
                  {row.name}
                </span>
                {row.activity && (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: "var(--cx-text-faint)",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    · {row.activity}
                  </span>
                )}
              </div>
            ))}
          </section>
        )}
      </div>

      {/* ===== footer（键盘提示，mono 10 faint，顶边）===== */}
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderTop: "1px solid var(--cx-line-hairline)",
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: 0.5,
          color: "var(--cx-text-faint)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          boxSizing: "border-box",
        }}
      >
        <button
          type="button"
          data-testid="conmux-home-new"
          onClick={onNewDefault}
          title="新建默认会话"
          style={{
            font: "inherit",
            color: "inherit",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            letterSpacing: "inherit",
          }}
        >
          Ctrl+K 命令面板 ⏎ 打开 · n 新建 · 全键盘
        </button>
      </div>
    </div>
  );
};

export { Home };
