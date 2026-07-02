// ===== Slice 3 pin UI（F2 2026-07-03 自 App.tsx 抽出，行为零变）=====
//
// spawn 被信任校验拒绝时的提示弹窗：显示被拒程序路径 + 原因；「信任并启动」→
// trust_pin_executable → 重试（父级 handlePinAndRetry）；「取消」关弹窗。
// 走 --cx-* 变量随风格；不追求终版视觉（终版另走 Pencil）。
// pinning 时禁用按钮防双击；pinError 显 pin 失败原因。

import type { FC } from "react";
import type { SpawnUntrustedError } from "../lib/sessions";

export const PinPrompt: FC<{
  prompt: SpawnUntrustedError;
  pinning: boolean;
  pinError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ prompt, pinning, pinError, onConfirm, onCancel }) => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 1100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.4)",
    }}
  >
    <div
      style={{
        background: "var(--cx-surface-raised)",
        border: "1px solid var(--cx-line-hairline)",
        borderRadius: 8,
        padding: 24,
        maxWidth: 480,
        width: "90%",
        color: "var(--cx-text-primary)",
        fontFamily: "var(--cx-font-sans, system-ui, sans-serif)",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
        程序未签名，无法启动
      </div>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <strong>路径：</strong>
        <code
          style={{
            display: "block",
            marginTop: 4,
            padding: 8,
            background: "var(--cx-surface-base)",
            borderRadius: 4,
            wordBreak: "break-all",
            fontSize: 12,
          }}
        >
          {prompt.program}
        </code>
      </div>
      <div style={{ fontSize: 13, marginBottom: 8, color: "var(--cx-text-content)" }}>
        <strong>原因：</strong>
        {prompt.reason}
      </div>
      {pinError && (
        <div
          style={{
            fontSize: 12,
            marginBottom: 8,
            color: "var(--cx-accent-signal, #c0392b)",
          }}
        >
          信任失败：{pinError}
        </div>
      )}
      <div style={{ fontSize: 12, marginBottom: 16, color: "var(--cx-text-content)" }}>
        信任后将记录此程序的 SHA-256 哈希，后续启动不再拦截。仅信任你确认安全的程序。
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={pinning}
          style={{
            padding: "8px 16px",
            background: "var(--cx-surface-chrome)",
            border: "1px solid var(--cx-line-hairline)",
            borderRadius: 4,
            color: "var(--cx-text-primary)",
            cursor: pinning ? "not-allowed" : "pointer",
            fontSize: 13,
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pinning || !prompt.pinnable}
          style={{
            padding: "8px 16px",
            background: "var(--cx-accent-signal)",
            border: "1px solid var(--cx-accent-signal)",
            borderRadius: 4,
            color: "#fff",
            cursor: pinning ? "not-allowed" : "pointer",
            fontSize: 13,
            opacity: pinning ? 0.6 : 1,
          }}
        >
          {pinning ? "信任中…" : "信任并启动"}
        </button>
      </div>
    </div>
  </div>
);
