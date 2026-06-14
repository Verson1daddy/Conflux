export const CTRL_C = "\x03";

type MaybePromise = void | Promise<void>;

interface TerminalInputControllerOptions {
  hasSelection: () => boolean;
  getSelection: () => string;
  copyText: (text: string) => MaybePromise;
  sendData: (data: string) => MaybePromise;
  echoLocal: (data: string) => void;
  allowEchoFallback?: boolean;
  onSendFailure?: (data: string, error?: unknown) => void;
  onSendSuccess?: () => void;
}

interface TerminalInputController {
  handleData: (data: string) => void;
}

function runWithFallback(
  action: () => MaybePromise,
  handlers?: {
    onSuccess?: () => void;
    onFailure?: (error?: unknown) => void;
  },
): void {
  try {
    void Promise.resolve(action())
      .then(() => {
        handlers?.onSuccess?.();
      })
      .catch((error) => {
        handlers?.onFailure?.(error);
      });
  } catch (error) {
    handlers?.onFailure?.(error);
  }
}

export function createTerminalInputController(
  options: TerminalInputControllerOptions,
): TerminalInputController {
  const sendData = (data: string) => {
    runWithFallback(() => options.sendData(data), {
      onSuccess: () => options.onSendSuccess?.(),
      onFailure: (error) => {
        if (options.allowEchoFallback) {
          options.echoLocal(data);
        }
        options.onSendFailure?.(data, error);
      },
    });
  };

  return {
    handleData(data: string) {
      // Ctrl+C：有选区 = 复制（Windows Terminal 同款行为）；无选区 = 立即透传
      // \x03（标准终端语义）。2026-06-13 移除原"双击武装窗"——它吞掉第一次按键，
      // 叠加 claude 自身的二次确认（"Press Ctrl-C again to exit"）后用户需 4 次
      // 精确节奏按键才能退出，实际不可用（用户实报）。防误退由 CLI 自身的二次
      // 确认承担；\x03 注入可退出 claude 已经 ctrlc_probe 实证（^C×2 → exit 0）。
      if (data === CTRL_C && options.hasSelection()) {
        const selectedText = options.getSelection();
        if (selectedText.length > 0) {
          runWithFallback(() => options.copyText(selectedText));
        }
        return;
      }

      sendData(data);
    },
  };
}

// ===== 批3 §8：Ctrl+K 与终端输入隔离 =====
// 判断当前焦点是否落在 xterm 输入面（helper textarea 或任意 .xterm 内元素）。
// 结构化接口而非 DOM 类型：测试跑在 node 环境，生产侧传 document.activeElement
//（Element 结构兼容）。

interface FocusTargetLike {
  classList?: { contains(token: string): boolean };
  closest?: (selector: string) => unknown;
}

export function isTerminalFocusedElement(
  el: FocusTargetLike | null | undefined
): boolean {
  if (!el) return false;
  if (el.classList?.contains("xterm-helper-textarea")) return true;
  return Boolean(el.closest?.(".xterm"));
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    return;
  }

  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "true");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}
