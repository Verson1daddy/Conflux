// ===== PermissionDialog 组件 =====
// 权限审批弹窗：显示请求来源、操作描述、原始上下文（mono 字体）
// 两个按钮 Approve / Deny + 120 秒超时倒计时

import { type FC, useState, useEffect, useCallback, useRef } from "react";
import { respondToPermission } from "@/lib/tauri-bridge";
import { useIslandStore } from "@/stores/islandStore";
import type { PermissionRequest, PermissionDecision } from "@/types";

interface PermissionDialogProps {
  /** 要显示的权限请求 */
  request: PermissionRequest;
  /** 关闭弹窗回调 */
  onClose: () => void;
}

/**
 * PermissionDialog — 权限审批弹窗
 *
 * - 模态弹窗样式，深色毛玻璃背景
 * - 显示：请求来源 Agent 名 + 操作描述 + 原始上下文（raw_context, mono 字体）
 * - 两个按钮：Approve（绿色）/ Deny（红色）
 * - 超时倒计时（从 request.timeout_seconds 开始，默认 120 秒）
 * - 超时自动关闭
 */
const PermissionDialog: FC<PermissionDialogProps> = ({ request, onClose }) => {
  const removePermissionRequest = useIslandStore(
    (s) => s.removePermissionRequest
  );

  // 倒计时状态
  const timeoutSeconds = request.timeout_seconds || 120;
  const elapsedAtMount = Math.max(
    0,
    Math.floor((Date.now() - request.created_at) / 1000)
  );
  const initialRemaining = Math.max(0, timeoutSeconds - elapsedAtMount);
  const [remaining, setRemaining] = useState(initialRemaining);

  // 防止重复提交
  const [submitting, setSubmitting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 倒计时 effect
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          // 超时 → 自动关闭
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
          }
          removePermissionRequest(request.id);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [request.id, removePermissionRequest, onClose]);

  // 处理决定（Approve 或 Deny）
  const handleDecision = useCallback(
    async (decision: PermissionDecision) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        await respondToPermission(request.instance_id, request.id, decision);
      } catch {
        // 即使后端调用失败也移除请求，避免卡住
      }
      removePermissionRequest(request.id);
      onClose();
    },
    [request.id, submitting, removePermissionRequest, onClose]
  );

  // 格式化倒计时 mm:ss
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeDisplay = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  // 倒计时颜色：< 30s 变红
  const timeColor = remaining < 30 ? "text-red-400" : "text-white/50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Permission request"
    >
      {/* 背景遮罩：深色毛玻璃 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 弹窗主体 */}
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-surface-dark/95 backdrop-blur-xl border border-white/10 shadow-elevated overflow-hidden">
        {/* 头部 */}
        <div className="px-5 pt-5 pb-3">
          {/* 标题行 */}
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-display font-semibold text-white">
              Permission Request
            </h2>
            <span className={`text-xs font-mono ${timeColor}`}>
              {timeDisplay}
            </span>
          </div>

          {/* 来源 Agent */}
          <p className="text-xs font-body text-white/50">
            From:{" "}
            <span className="text-accent">
              {request.instance_id}
            </span>
          </p>
        </div>

        {/* 操作描述 */}
        <div className="px-5 pb-3">
          <div className="rounded-lg bg-white/5 px-3 py-2.5">
            <p className="text-xs font-body text-white/40 mb-1">Action</p>
            <p className="text-sm font-body text-white/90">
              {request.action}
            </p>
            {request.description && (
              <p className="text-xs font-body text-white/60 mt-1">
                {request.description}
              </p>
            )}
          </div>
        </div>

        {/* 原始上下文（raw_context）— mono 字体 */}
        {request.raw_context && request.raw_context.length > 0 && (
          <div className="px-5 pb-3">
            <p className="text-[10px] font-body text-white/40 mb-1 uppercase tracking-wider">
              Context
            </p>
            <div className="rounded-lg bg-black/40 border border-white/5 p-3 max-h-40 overflow-y-auto">
              {request.raw_context.map((line, idx) => (
                <p
                  key={idx}
                  className="text-[11px] font-mono text-white/60 leading-relaxed whitespace-pre-wrap break-all"
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* 超时进度条 */}
        <div className="px-5 pb-3">
          <div className="h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                remaining < 30 ? "bg-red-500" : "bg-accent"
              }`}
              style={{
                width: `${(remaining / timeoutSeconds) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-body font-medium
              bg-red-500/15 text-red-400 border border-red-500/20
              hover:bg-red-500/25 hover:border-red-500/30
              transition-colors duration-200
              disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleDecision("deny")}
            disabled={submitting}
            aria-label="Deny permission request"
          >
            Deny
          </button>
          <button
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-body font-medium
              bg-green-500/15 text-green-400 border border-green-500/20
              hover:bg-green-500/25 hover:border-green-500/30
              transition-colors duration-200
              disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleDecision("approve")}
            disabled={submitting}
            aria-label="Approve permission request"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
};

export { PermissionDialog };
