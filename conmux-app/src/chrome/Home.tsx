// ===== Home 仪表盘（M⑤b F1 契约 §4 · M⑤d overlay + 全键盘，.pen 6Faub B 风格）=====
//
// 两模式同一组件（M⑤d §2）：
//   - landing（overlay=false，默认）：0 会话时 App 渲，position:absolute inset:0 填 body；
//     RUNNING 段仍按 D-6（sessions>0 才渲；0 会话 Home 隐——避免常空段）。
//   - overlay（overlay=true）：leader+h 在「有会话」时把 Home 作为可关闭叠层开在活跃会话之上
//     （fixed scrim + 居中 raised card，同命令面板）。RUNNING 段恒渲染（有会话才会开 overlay，
//     故非空）且每行可点 → onSelectRunning(instanceId)（切到该会话 + 关叠层）。
//
// 全键盘导航（M⑤d §3）：把可选项拍平成有序列表 items =
//   [...recent(reopen), ...quick(launch), ...(overlay? running(select): [])]；
//   selectedIndex state，↑↓ wrap 移、⏎ 激活当前项（按类型 reopen/launch/select）、
//   esc → overlay 模式 onClose（landing 模式 esc 无操作）。＋加项不入键盘流（鼠标点即可）。
//   选中视觉复用命令面板（`▸` 前缀 + `--cx-surface-chrome` 底）；选中行 data-home-selected="true"。
//   键盘 handler 挂 Home 容器（overlay autoFocus / landing tabIndex 可聚焦）；不与 leader 机冲突
//   （overlay 时 leader 被 isBlocked 抑制；landing 时无 leader 待命，Home 容器捕获 ↑↓⏎）。
//
// 全走 --cx-* 变量随风格自适应（明暗皆可）。纯前端，零 Rust/conflux 改动。
//
// 数据：launch-registry（QUICK LAUNCH，store + subscribe）+ sessions store（RECENT / RUNNING）。
// RUNNING activity 来自各会话 observer 的 AwareState（由 App 经 props 注入；无则略）。

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  addEntry,
  getLaunchEntries,
  parseCommand,
  removeEntry,
  subscribeLaunchEntries,
  updateEntry,
  type LaunchEntry,
} from "../lib/launch-registry";
import {
  getRecent,
  getSessions,
  subscribeSessions,
  type RecentEntry,
} from "../lib/sessions";
import type { SessionStatus } from "./session-status";
import { ConmuxBrandMark } from "./ConmuxBrandMark";

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
  /** RUNNING 行（overlay 模式恒渲染；landing 模式仅 sessions.length>0 才有，0 会话时 []）。 */
  running: HomeRunningRow[];
  /** 新建默认会话（QUICK LAUNCH 无关的「n」/兜底入口）。 */
  onNewDefault: () => void;
  /** 点 QUICK LAUNCH chip → 起为新会话（D-1）。 */
  onLaunch: (entry: LaunchEntry) => void;
  /** 重开 RECENT 条目。 */
  onReopenRecent: (entry: RecentEntry) => void;
  /**
   * overlay 叠层模式（M⑤d §2）：默认 false = landing（0 会话时 App 渲）；
   * true = leader+h 叠层（fixed scrim + 居中 card，覆盖活跃会话）。
   */
  overlay?: boolean;
  /** overlay 关闭（esc / 点 scrim / 激活某项后）。landing 模式无意义。 */
  onClose?: () => void;
  /** 点 RUNNING 行 → 切会话（App 传 setActive 包装 + onClose）。仅 overlay 模式渲可点行。 */
  onSelectRunning?: (instanceId: string) => void;
}

/** 拍平后的可选项（键盘导航单元）。＋加项不入此列表（鼠标点）。 */
type HomeItem =
  | { kind: "recent"; entry: RecentEntry }
  | { kind: "launch"; entry: LaunchEntry }
  | { kind: "running"; row: HomeRunningRow };

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

/** chip 次级钮（编辑 ✎ / 删除 ×）共用样式（M⑤h；active=正被编辑时高亮）。 */
function chipSecondaryStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    padding: 0,
    borderRadius: 4,
    border: "none",
    background: active ? "var(--cx-surface-chrome)" : "transparent",
    color: active ? "var(--cx-accent-signal)" : "var(--cx-text-faint)",
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 1,
    cursor: "pointer",
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

/** 选中行的 `▸` 前缀（仅 selected 渲，复用命令面板视觉）。 */
const SelMarker: FC<{ on: boolean }> = ({ on }) =>
  on ? (
    <span
      aria-hidden
      style={{
        fontFamily: MONO,
        fontSize: 13,
        lineHeight: 1,
        color: "var(--cx-accent-signal)",
        flex: "0 0 auto",
      }}
    >
      ▸
    </span>
  ) : null;

const Home: FC<HomeProps> = ({
  sessionCount,
  daemonConnected,
  running,
  onNewDefault,
  onLaunch,
  onReopenRecent,
  overlay = false,
  onClose,
  onSelectRunning,
}) => {
  // 订阅注册表 + 会话 store（RECENT 随会话关闭变动 → 重渲）。
  const entries = useSyncExternalStore(subscribeLaunchEntries, getLaunchEntries);
  // RECENT 与 sessions 同 store（同一 notify 广播）。
  const recent = useSyncExternalStore(subscribeSessions, getRecent);
  // sessions 用于 landing 模式 RUNNING 段渲染判定（D-6；overlay 模式恒渲）。
  const sessions = useSyncExternalStore(subscribeSessions, getSessions);
  // RUNNING 段是否渲染：overlay 模式恒渲（有会话才会开）；landing 模式按 D-6（sessions>0）。
  const showRunning = overlay || sessions.length > 0;
  // RUNNING 行是否进键盘流 + 可点：仅 overlay 模式（landing 模式 RUNNING 只读概览）。
  const runningInteractive = overlay;

  // ＋加项内联表单（v1：name + command + cwd 可选；提交即写注册表，store 广播刷新 chips）。
  // M⑤h：同一表单复用为编辑（editId 非 null = 编辑该项，预填 name/command/cwd → updateEntry；
  // null = 新增 → addEntry）。
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const [addCwd, setAddCwd] = useState("");

  // ===== 全键盘导航：拍平可选项（M⑤d §3）=====
  // 顺序 = [...recent(reopen), ...quick(launch), ...(overlay? running(select): [])]。
  const items: HomeItem[] = [
    ...recent.map((entry): HomeItem => ({ kind: "recent", entry })),
    ...entries.map((entry): HomeItem => ({ kind: "launch", entry })),
    ...(runningInteractive
      ? running.map((row): HomeItem => ({ kind: "running", row }))
      : []),
  ];
  const [selectedIndex, setSelectedIndex] = useState(0);

  // items 长度变（增删启动项 / 会话变动）→ clamp selectedIndex 回有效范围。
  useEffect(() => {
    if (selectedIndex >= items.length) {
      setSelectedIndex(items.length > 0 ? items.length - 1 : 0);
    }
  }, [items.length, selectedIndex]);

  // 两模式都聚焦容器（接管 ↑↓⏎esc；不依赖 input 焦点）：overlay 开时；landing 0 会话首进时
  // 即可键盘导航无需先点（红队 M⑤d LOW-2）。0 会话 landing 时无终端竞争焦点，安全。
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => containerRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [overlay]);

  /** 关闭并清空加项 / 编辑表单。 */
  const closeForm = (): void => {
    setAddOpen(false);
    setEditId(null);
    setAddName("");
    setAddCommand("");
    setAddCwd("");
  };

  /** 打开编辑表单（预填该项 name/command/cwd；提交走 updateEntry）。 */
  const openEdit = (entry: LaunchEntry): void => {
    setEditId(entry.id);
    setAddName(entry.name);
    setAddCommand(entry.command);
    setAddCwd(entry.cwd ?? "");
    setAddOpen(true);
  };

  const submitAdd = (): void => {
    const name = addName.trim();
    const command = addCommand.trim();
    if (name === "" || command === "") return; // 必填校验（诚实：不建空目标）。
    const cwd = addCwd.trim();
    if (editId !== null) {
      // 编辑：cwd 空串 → updateEntry 删 cwd（继承当前目录）；非空 → 设。
      updateEntry(editId, { name, command, cwd });
    } else {
      addEntry({ name, command, ...(cwd ? { cwd } : {}) });
    }
    closeForm();
  };

  /** 激活当前选中项（⏎ / 行点击）。按类型分派；激活后 overlay 模式关闭叠层。 */
  const activateItem = (item: HomeItem): void => {
    switch (item.kind) {
      case "recent":
        onReopenRecent(item.entry);
        break;
      case "launch":
        onLaunch(item.entry);
        break;
      case "running":
        onSelectRunning?.(item.row.instanceId);
        break;
    }
    if (overlay) onClose?.();
  };

  /** 容器键盘仲裁（↑↓ wrap 移选、⏎ 激活、esc → overlay onClose）。 */
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // 焦点在加项表单输入框时不抢键（让打字正常；加项表单自有 ⏎/esc 处理）。
    const tgt = e.target as HTMLElement | null;
    const tag = tgt?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) setSelectedIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        setSelectedIndex((i) => (i - 1 + items.length) % items.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) activateItem(item);
    } else if (e.key === "Escape") {
      if (overlay) {
        e.preventDefault();
        onClose?.();
      }
      // landing 模式 esc 无操作（无叠层可关）。
    }
  };

  // recent / quick / running 段在拍平列表中的起始下标（用于行渲染时算 selected）。
  const recentBase = 0;
  const launchBase = recent.length;
  const runningBase = recent.length + entries.length;

  // ===== Home 内容（两模式共用）=====
  const content = (
    <>
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
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: 20,
            fontWeight: 500,
            color: "var(--cx-accent-signal)",
            letterSpacing: 0.2,
          }}
        >
          <ConmuxBrandMark size={19} color="var(--cx-text-primary)" />
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

      {/* ===== body（vertical gap 18, padding [14,18], 可滚）===== */}
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
            recent.map((r, idx) => {
              const flatIdx = recentBase + idx;
              const isSel = flatIdx === selectedIndex;
              return (
                <button
                  key={`${r.command}|${r.cwd ?? ""}|${idx}`}
                  type="button"
                  data-testid="conmux-home-recent-item"
                  data-recent-idx={idx}
                  data-home-selected={isSel ? "true" : "false"}
                  onClick={() => activateItem({ kind: "recent", entry: r })}
                  onMouseEnter={() => setSelectedIndex(flatIdx)}
                  title={`重开 ${r.name}（${r.command}）`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    width: "100%",
                    padding: isSel ? "6px 8px" : "6px 8px 6px 8px",
                    border: "none",
                    borderRadius: 6,
                    background: isSel
                      ? "var(--cx-surface-chrome)"
                      : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    boxSizing: "border-box",
                  }}
                >
                  <SelMarker on={isSel} />
                  {!isSel && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--cx-text-faint)",
                        flex: "0 0 auto",
                      }}
                    />
                  )}
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
              );
            })
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
            {entries.map((entry, idx) => {
              const { program } = parseCommand(entry.command);
              const flatIdx = launchBase + idx;
              const isSel = flatIdx === selectedIndex;
              const editing = editId === entry.id;
              return (
                // chip 容器（M⑤h）：主体 launch 钮 + 次级 编辑/删除 钮（次级钮 stopPropagation，
                // 不触发启动）。容器随 selectedIndex 高亮（hover/键盘选中视觉随主体）。
                <div
                  key={entry.id}
                  data-testid="conmux-home-quick-chip"
                  data-entry-id={entry.id}
                  onMouseEnter={() => setSelectedIndex(flatIdx)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    height: 30,
                    paddingRight: 4,
                    borderRadius: 6,
                    border: isSel
                      ? "1px solid var(--cx-accent-signal)"
                      : "1px solid var(--cx-line-soft)",
                    background: isSel
                      ? "var(--cx-surface-chrome)"
                      : "var(--cx-surface-raised)",
                    boxSizing: "border-box",
                    whiteSpace: "nowrap",
                  }}
                >
                  {/* 主体：启动该项（点 chip 主体 = 启动，不变）。 */}
                  <button
                    type="button"
                    data-testid="conmux-home-quick-item"
                    data-entry-id={entry.id}
                    data-home-selected={isSel ? "true" : "false"}
                    onClick={() => activateItem({ kind: "launch", entry })}
                    title={`启动 ${entry.name}（${program || entry.command}）`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      height: 28,
                      padding: "0 4px 0 12px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      boxSizing: "border-box",
                      whiteSpace: "nowrap",
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
                      {isSel ? "▸" : "›"}
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
                  {/* 次级：编辑（✎）—— 复用加项内联表单（预填 → updateEntry）。 */}
                  <button
                    type="button"
                    data-testid="conmux-home-quick-edit"
                    data-entry-id={entry.id}
                    aria-label={`编辑 ${entry.name}`}
                    title={`编辑 ${entry.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(entry);
                    }}
                    style={chipSecondaryStyle(editing)}
                  >
                    ✎
                  </button>
                  {/* 次级：删除（×）—— removeEntry（种子项也可删，M⑤b 设计）。 */}
                  <button
                    type="button"
                    data-testid="conmux-home-quick-remove"
                    data-entry-id={entry.id}
                    aria-label={`删除 ${entry.name}`}
                    title={`删除 ${entry.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      // 删除正被编辑的项时一并收掉表单（避免编辑悬空项）。
                      if (editId === entry.id) closeForm();
                      removeEntry(entry.id);
                    }}
                    style={chipSecondaryStyle(false)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {/* ＋ 加项入口（toggle 内联表单）。不入键盘流（鼠标点）。 */}
            <button
              type="button"
              data-testid="conmux-home-add"
              aria-label="新增启动项"
              aria-expanded={addOpen}
              title="新增启动项"
              onClick={() => {
                // 开 → 关（清表单含编辑态）；关 → 开「新增」（清残留编辑预填）。
                if (addOpen) closeForm();
                else {
                  setEditId(null);
                  setAddName("");
                  setAddCommand("");
                  setAddCwd("");
                  setAddOpen(true);
                }
              }}
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

          {/* 内联加项 / 编辑表单（name + command 必填 · cwd 可选；⏎ 提交、esc 取消）。
              M⑤h：editId 非 null 时为编辑（预填该项，提交走 updateEntry）。 */}
          {addOpen && (
            <div
              data-testid="conmux-home-add-form"
              data-edit-id={editId ?? undefined}
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
                  e.stopPropagation();
                  submitAdd();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeForm();
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
                {editId !== null ? "保存" : "添加"}
              </button>
            </div>
          )}
        </section>

        {/* ── RUNNING ──（overlay 模式恒渲 + 可点；landing 模式仅 sessions>0 渲且只读，D-6）== */}
        {showRunning && (
          <section
            data-testid="conmux-home-running"
            style={{ display: "flex", flexDirection: "column", gap: 9 }}
          >
            <SectionHeader label="RUNNING" />
            {running.map((row, idx) => {
              const flatIdx = runningBase + idx;
              const isSel = runningInteractive && flatIdx === selectedIndex;
              return (
                <div
                  key={row.instanceId}
                  data-testid="conmux-home-running-item"
                  data-instance-id={row.instanceId}
                  data-home-selected={isSel ? "true" : "false"}
                  role={runningInteractive ? "button" : undefined}
                  tabIndex={runningInteractive ? -1 : undefined}
                  onClick={
                    runningInteractive
                      ? () => activateItem({ kind: "running", row })
                      : undefined
                  }
                  onMouseEnter={
                    runningInteractive
                      ? () => setSelectedIndex(flatIdx)
                      : undefined
                  }
                  title={
                    runningInteractive ? `切到 ${row.name}` : undefined
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: isSel
                      ? "var(--cx-surface-chrome)"
                      : "transparent",
                    cursor: runningInteractive ? "pointer" : "default",
                    boxSizing: "border-box",
                  }}
                >
                  <SelMarker on={isSel} />
                  {!isSel && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: STATUS_VAR[row.status],
                        flex: "0 0 auto",
                      }}
                    />
                  )}
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
              );
            })}
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
          ↑↓ 选择 · ⏎ 打开 · n 新建 · Ctrl+K 命令面板
          {overlay ? " · esc 关闭" : ""}
        </button>
      </div>
    </>
  );

  // ===== overlay 模式：fixed scrim + 居中 raised card（同命令面板，M⑤d §2）=====
  if (overlay) {
    return (
      <div
        data-testid="conmux-home-scrim"
        onMouseDown={(e) => {
          // 仅点 scrim 本体（非 card 内）才关闭。
          if (e.target === e.currentTarget) onClose?.();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          paddingTop: "10vh",
          boxSizing: "border-box",
        }}
      >
        <div
          ref={containerRef}
          data-testid="conmux-home"
          data-overlay="true"
          role="dialog"
          aria-modal="true"
          aria-label="Home 概览"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: 560,
            maxWidth: "92vw",
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            borderRadius: 12,
            background: "var(--cx-surface-base)",
            border: "1px solid var(--cx-line-hairline)",
            boxShadow: "0 12px 32px #00000055",
            overflow: "hidden",
            outline: "none",
            boxSizing: "border-box",
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  // ===== landing 模式：position:absolute inset:0 填 body（不变）=====
  return (
    <div
      ref={containerRef}
      data-testid="conmux-home"
      data-overlay="false"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--cx-surface-base)",
        boxSizing: "border-box",
        overflow: "hidden",
        outline: "none",
      }}
    >
      {content}
    </div>
  );
};

export { Home };
