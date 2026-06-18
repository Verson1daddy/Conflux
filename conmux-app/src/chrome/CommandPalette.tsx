// ===== 命令面板叠层（Ctrl+K，M⑤a，F1 契约 §1/§3/§5）=====
//
// CLI-home 招牌交互：scrim 压暗全窗 + 居中 raised card（input + results + footer）。
//   - 动作集开面板时构建一次（buildCommandActions，实时 sessions/styles 快照）。
//   - 模糊搜（title+category 大小写不敏感子序列/包含，D-4 轻量无库）→ ↑↓ 选 → ⏎ 执行。
//   - 风格动作预览/还原闭环（§5 最关键，D-2）：
//       高亮 isPreview 项 → preview()（瞬态套用，不持久）。
//       离开预览项 / 关闭面板未执行 → 还原 getCurrentStyle()（重应用 chrome+terminal）。
//       执行预览项（⏎ run 持久化）→ 不还原（已 setStyle，App effect 接管）。
//       任何关闭路径（esc/scrim/blur）先还原再关（除非刚执行）。无半应用态。
//   - run() 抛错 → 内联报错行（不静默、不关，§4.3）。
//
// 全走 --cx-* 变量随风格自适应（明暗风格皆可）。纯前端，零 Rust/conflux 改动（D-5）。

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { setTerminalTheme } from "@conmux/terminal-core";
import { applyChromeVars, getCurrentStyle } from "../lib/style";
import { buildCommandActions, type CommandAction } from "../command/registry";

const MONO = "'JetBrains Mono', 'JetBrains Mono Variable', monospace";

export interface CommandPaletteProps {
  /** 是否打开（App.tsx 据 paletteOpen 条件挂载）。 */
  open: boolean;
  /** 关闭回调（esc/scrim/失焦/执行后）。 */
  onClose: () => void;
  /** 「设置 leader 前缀」动作回调（App：关面板 + 开 leader 配置 modal）。 */
  onConfigureLeader?: () => void;
}

/**
 * 模糊匹配：title+category 大小写不敏感，先包含、退化到子序列（D-4 轻量）。
 * 空 query → 全部命中（保持默认序）。
 */
function matches(action: CommandAction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = `${action.category} ${action.title}`.toLowerCase();
  if (hay.includes(q)) return true;
  // 子序列匹配（按 q 字符顺序在 hay 中依次出现）。
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) {
      i += 1;
      if (i === q.length) return true;
    }
  }
  return false;
}

/** 还原当前持久风格（撤销任何预览瞬态）。chrome 半 + 终端半同步。 */
function restoreCurrentStyle(): void {
  const current = getCurrentStyle();
  applyChromeVars(current);
  setTerminalTheme(current.terminal_theme_id);
}

const CommandPalette: FC<CommandPaletteProps> = ({
  open,
  onClose,
  onConfigureLeader,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 开面板时构建动作集（实时快照）。query 变化不重建（动作集本轮固定）。
  const actions = useMemo<CommandAction[]>(
    () => (open ? buildCommandActions({ onConfigureLeader }) : []),
    [open, onConfigureLeader]
  );

  // 过滤结果（query 变化重算）。
  const results = useMemo<CommandAction[]>(
    () => actions.filter((a) => matches(a, query)),
    [actions, query]
  );

  // ref 跟踪"是否已执行"：执行后关闭不还原（避免覆盖 setStyle 持久态）。
  const executedRef = useRef(false);
  // ref 跟踪当前预览项 id：用于判断 selectedIndex 变化是否"离开了预览项"。
  const previewedIdRef = useRef<string | null>(null);

  // 开面板：重置态 + autoFocus + 复位 executed/previewed。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setError(null);
    executedRef.current = false;
    previewedIdRef.current = null;
    // autoFocus（ref 兜底；input 自带 autoFocus，双保险应对条件挂载时序）。
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // query 变化导致结果集变 → selectedIndex clamp 回有效范围（越界归 0）。
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(results.length > 0 ? results.length - 1 : 0);
    }
  }, [results.length, selectedIndex]);

  // ===== 预览/还原闭环（§5 核心，D-2）=====
  // 高亮项变化 → 若新高亮 isPreview 调 preview()；否则（且此前在预览）还原。
  const highlighted = results[selectedIndex] ?? null;
  useEffect(() => {
    if (!open) return;
    const prevId = previewedIdRef.current;
    if (highlighted && highlighted.isPreview) {
      // 进入/切换到预览项：套用瞬态（即便 id 相同，重渲也幂等 re-apply 无害）。
      highlighted.preview?.();
      previewedIdRef.current = highlighted.id;
    } else {
      // 当前高亮非预览项：若此前在预览某项，则还原（离开预览项）。
      if (prevId !== null) {
        restoreCurrentStyle();
        previewedIdRef.current = null;
      }
    }
  }, [open, highlighted]);

  // 卸载/关闭兜底：组件卸载（条件挂载下 open→false 即卸载）时，若处于预览态且未执行 → 还原。
  // 注意：执行预览项时 executedRef=true，run() 已 setStyle 持久化，不能还原（否则覆盖）。
  useEffect(() => {
    return () => {
      if (previewedIdRef.current !== null && !executedRef.current) {
        restoreCurrentStyle();
        previewedIdRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  /** 关闭（先还原预览态——除非刚执行——再回调 onClose）。 */
  const closeWithRestore = (): void => {
    if (previewedIdRef.current !== null && !executedRef.current) {
      restoreCurrentStyle();
      previewedIdRef.current = null;
    }
    onClose();
  };

  /** 执行高亮项（⏎）。预览项执行 = run 持久化 → 不还原；执行后关闭。run 抛错 → 内联报错不关。 */
  const execute = async (action: CommandAction): Promise<void> => {
    setError(null);
    try {
      // 执行前置 executedRef：预览项 run() 持久化后，任何关闭路径都不应还原。
      executedRef.current = true;
      await action.run();
      // 预览态已被 run 接管（setStyle→useStyle→App effect 重应用），清预览引用不再还原。
      previewedIdRef.current = null;
      onClose();
    } catch (e) {
      // 执行失败：内联报错行，不静默、不关；复位 executedRef（允许后续重试/还原）。
      executedRef.current = false;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** input 键盘仲裁：↑↓ 移选、⏎ 执行、esc 关闭（先还原）。 */
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((i) => (i + 1) % results.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((i) => (i - 1 + results.length) % results.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = results[selectedIndex];
      if (action) void execute(action);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeWithRestore();
    }
  };

  const hasResults = results.length > 0;

  return (
    // ===== scrim：全窗压暗 + 点击关闭（先还原）=====
    <div
      data-testid="conmux-cmdk"
      onMouseDown={(e) => {
        // 仅点 scrim 本体（非 card 内）才关闭。
        if (e.target === e.currentTarget) closeWithRestore();
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
        paddingTop: "15vh",
        boxSizing: "border-box",
      }}
    >
      {/* ===== palette card（width 470 max 90vw · radius 10 · raised · hairline · outer shadow）===== */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 470,
          maxWidth: "90vw",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 10,
          background: "var(--cx-surface-raised)",
          border: "1px solid var(--cx-line-hairline)",
          boxShadow: "0 10px 28px #00000044",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {/* ===== input 行（›prompt + query + 右 hint，底边 soft）===== */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid var(--cx-line-soft)",
            boxSizing: "border-box",
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: 16,
              fontWeight: 700,
              lineHeight: 1,
              color: "var(--cx-accent-signal)",
              flex: "0 0 auto",
            }}
          >
            ›
          </span>
          <input
            ref={inputRef}
            data-testid="conmux-cmdk-input"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            // 失焦即关闭（先还原）——modal 语义：点 card 外或 Tab 走焦点都收起。
            onBlur={closeWithRestore}
            placeholder="模糊搜命令…"
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: MONO,
              fontSize: 14,
              lineHeight: 1.2,
              color: "var(--cx-text-content)",
              padding: 0,
            }}
          />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: 1,
              color: "var(--cx-text-faint)",
              flex: "0 0 auto",
              whiteSpace: "nowrap",
            }}
          >
            命令面板
          </span>
        </div>

        {/* ===== results 列（可滚 max-height，active 行高亮 + ▸ 前缀）===== */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: "6px 8px 8px 8px",
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
          {hasResults ? (
            results.map((action, idx) => {
              const isSel = idx === selectedIndex;
              return (
                <div
                  key={action.id}
                  data-testid="conmux-cmdk-row"
                  data-action-id={action.id}
                  data-selected={isSel ? "true" : "false"}
                  // mouseDown 抢在 input blur 前：避免点击行先触发 blur 关闭。
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSelectedIndex(idx);
                  }}
                  onClick={() => void execute(action)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: isSel ? "8px 10px" : "8px 10px 8px 22px",
                    borderRadius: 6,
                    background: isSel ? "var(--cx-surface-chrome)" : "transparent",
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                >
                  {isSel && (
                    <span
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
                  )}
                  {/* 类别灰前缀（参与可读，模糊搜亦命中 category）。 */}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      lineHeight: 1.2,
                      color: "var(--cx-text-faint)",
                      flex: "0 0 auto",
                    }}
                  >
                    {action.category} ·
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: isSel ? 13 : 13,
                      lineHeight: 1.2,
                      color: isSel
                        ? "var(--cx-text-content)"
                        : "var(--cx-text-muted)",
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {action.title}
                  </span>
                  {action.hint && (
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        letterSpacing: 0.5,
                        color: "var(--cx-text-muted)",
                        flex: "0 0 auto",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {action.hint}
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <div
              data-testid="conmux-cmdk-empty"
              style={{
                padding: "10px 14px",
                fontFamily: MONO,
                fontSize: 13,
                color: "var(--cx-text-muted)",
              }}
            >
              无匹配
            </div>
          )}

          {/* 执行失败内联报错行（不静默、不关，§4.3）。 */}
          {error && (
            <div
              data-testid="conmux-cmdk-error"
              style={{
                margin: "4px 0 0 0",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid var(--cx-status-attention)",
                fontFamily: MONO,
                fontSize: 12,
                lineHeight: 1.3,
                color: "var(--cx-status-attention)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              执行失败：{error}
            </div>
          )}
        </div>

        {/* ===== footer（提示行；顶边 soft）===== */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--cx-line-soft)",
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 1,
            color: "var(--cx-text-faint)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            boxSizing: "border-box",
          }}
        >
          {hasResults
            ? "↑↓ 选择   ⏎ 执行   esc 关闭   ·   模糊搜一切动作"
            : "esc 关闭   ·   无匹配"}
        </div>
      </div>
    </div>
  );
};

export { CommandPalette };
