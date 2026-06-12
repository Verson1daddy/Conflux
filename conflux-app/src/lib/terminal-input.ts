export const CTRL_C = "\x03";
export const INTERRUPT_ARM_WINDOW_MS = 1400;

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
  now?: () => number;
}

interface TerminalInputController {
  handleData: (data: string) => void;
  resetInterruptArm: () => void;
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
  let interruptArmedUntil = 0;
  const now = options.now ?? (() => Date.now());

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
      if (data === CTRL_C) {
        if (options.hasSelection()) {
          interruptArmedUntil = 0;
          const selectedText = options.getSelection();
          if (selectedText.length > 0) {
            runWithFallback(() => options.copyText(selectedText));
          }
          return;
        }

        const currentTime = now();
        if (currentTime <= interruptArmedUntil) {
          interruptArmedUntil = 0;
          sendData(CTRL_C);
          return;
        }

        interruptArmedUntil = currentTime + INTERRUPT_ARM_WINDOW_MS;
        return;
      }

      interruptArmedUntil = 0;
      sendData(data);
    },

    resetInterruptArm() {
      interruptArmedUntil = 0;
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
