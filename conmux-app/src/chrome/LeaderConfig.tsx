// ===== leader 前缀配置 modal（可配置化 2026-06-19）=====
//
// 命令面板「设置 leader 前缀」打开。捕获用户按下的新组合键 → 校验（必须带 Ctrl/Alt，
// 守 veto 不变量）→ 保存到 lib/leader-key（localStorage 持久 + 广播）。
//
// 键盘捕获：capture 阶段 document keydown。打开时 App 把 isBlocked 设为含本 modal →
// leader 机不 arm；leader 机 stopPropagation 非 immediate，同 target 后注册的本监听仍收到键。

import { useEffect, useRef, useState, type FC } from "react";
import {
  DEFAULT_LEADER,
  formatLeaderLabel,
  getLeaderChord,
  setLeaderChord,
  type LeaderChord,
} from "../lib/leader-key";

const MONO = "'JetBrains Mono', 'JetBrains Mono Variable', monospace";

export interface LeaderConfigProps {
  /** 关闭（保存后 / 取消 / esc / 点 scrim）。 */
  onClose: () => void;
}

const PURE_MODIFIERS = ["Control", "Alt", "Shift", "Meta"];

const LeaderConfig: FC<LeaderConfigProps> = ({ onClose }) => {
  const current = getLeaderChord();
  const [pending, setPending] = useState<LeaderChord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<LeaderChord | null>(null);
  pendingRef.current = pending;

  const save = (chord: LeaderChord): void => {
    setLeaderChord(chord);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 纯修饰键单发 → 等完整组合（不捕获）。
      if (PURE_MODIFIERS.includes(e.key)) return;
      // Esc → 关闭（不保存）。
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // Enter → 若已捕获有效组合则保存（否则忽略，不当作前缀候选）。
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (pendingRef.current) save(pendingRef.current);
        return;
      }
      // 其余键 = 候选前缀：吃掉（不漏给终端/leader 机）+ 校验。
      e.preventDefault();
      e.stopPropagation();
      if (!e.ctrlKey && !e.altKey) {
        setError("前缀必须带 Ctrl 或 Alt —— 裸键会把每次按键吞成 leader、弄坏 CLI。");
        setPending(null);
        return;
      }
      setError(null);
      setPending({
        ctrl: e.ctrlKey,
        alt: e.altKey,
        code: e.code,
        key: e.key,
      });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        data-testid="conmux-leader-config-scrim"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          background: "rgba(0, 0, 0, 0.42)",
        }}
      />
      <div
        role="dialog"
        aria-label="设置 leader 前缀"
        data-testid="conmux-leader-config"
        style={{
          position: "fixed",
          left: "50%",
          top: "32%",
          transform: "translate(-50%, -50%)",
          zIndex: 71,
          width: 360,
          maxWidth: "86vw",
          padding: 18,
          borderRadius: 12,
          background: "var(--cx-surface-raised)",
          border: "1px solid var(--cx-line-soft)",
          boxShadow: "0 16px 44px rgba(0, 0, 0, 0.4)",
          boxSizing: "border-box",
          fontFamily: MONO,
          color: "var(--cx-text-content)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--cx-text-primary)",
            marginBottom: 4,
          }}
        >
          设置 leader 前缀
        </div>
        <div style={{ fontSize: 11, color: "var(--cx-text-faint)", marginBottom: 14 }}>
          当前：
          <span style={{ color: "var(--cx-accent-signal)" }}>
            {formatLeaderLabel(current)}
          </span>
          　·　tmux 式前缀，须带 Ctrl 或 Alt
        </div>

        {/* 捕获框：显待保存组合 / 提示按键。 */}
        <div
          data-testid="conmux-leader-config-capture"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 56,
            borderRadius: 8,
            border: `1px dashed ${
              pending ? "var(--cx-accent-signal)" : "var(--cx-line-soft)"
            }`,
            background: "var(--cx-surface-base)",
            fontSize: 18,
            letterSpacing: 1,
            color: pending ? "var(--cx-accent-signal)" : "var(--cx-text-faint)",
          }}
        >
          {pending ? formatLeaderLabel(pending) : "按下新的组合键…"}
        </div>

        {error && (
          <div
            data-testid="conmux-leader-config-error"
            style={{ marginTop: 8, fontSize: 11, color: "var(--cx-status-warn)" }}
          >
            {error}
          </div>
        )}

        {/* 按钮行：恢复默认（左）· 取消 / 保存（右）。 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 16,
            gap: 8,
          }}
        >
          <button
            type="button"
            data-testid="conmux-leader-config-reset"
            onClick={() => setPending({ ...DEFAULT_LEADER })}
            style={btnStyle(false)}
          >
            恢复默认（{formatLeaderLabel(DEFAULT_LEADER)}）
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            data-testid="conmux-leader-config-cancel"
            onClick={onClose}
            style={btnStyle(false)}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="conmux-leader-config-save"
            disabled={!pending}
            onClick={() => pending && save(pending)}
            style={btnStyle(true, !pending)}
          >
            保存
          </button>
        </div>
      </div>
    </>
  );
};

function btnStyle(primary: boolean, disabled = false): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    fontFamily: MONO,
    fontSize: 12,
    cursor: disabled ? "default" : "pointer",
    border: primary ? "none" : "1px solid var(--cx-line-soft)",
    background: primary
      ? disabled
        ? "var(--cx-line-soft)"
        : "var(--cx-accent-signal)"
      : "transparent",
    color: primary
      ? disabled
        ? "var(--cx-text-faint)"
        : "var(--cx-surface-base)"
      : "var(--cx-text-content)",
    opacity: disabled ? 0.7 : 1,
    whiteSpace: "nowrap",
  };
}

export { LeaderConfig };
