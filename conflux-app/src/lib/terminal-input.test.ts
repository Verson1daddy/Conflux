import { describe, expect, it, vi } from "vitest";

import {
  CTRL_C,
  INTERRUPT_ARM_WINDOW_MS,
  createTerminalInputController,
  isTerminalFocusedElement,
} from "./terminal-input";

function createHarness() {
  let now = 10_000;
  let selection = "";
  const sent: string[] = [];
  const echoed: string[] = [];
  const copied: string[] = [];
  const sendData = vi.fn((data: string) => {
    sent.push(data);
  });
  const echoLocal = vi.fn((data: string) => {
    echoed.push(data);
  });
  const copyText = vi.fn((text: string) => {
    copied.push(text);
  });
  const controller = createTerminalInputController({
    hasSelection: () => selection.length > 0,
    getSelection: () => selection,
    copyText,
    sendData,
    echoLocal,
    now: () => now,
  });

  return {
    controller,
    sent,
    echoed,
    copied,
    sendData,
    echoLocal,
    copyText,
    setSelection: (next: string) => {
      selection = next;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("terminal input controller", () => {
  it("forwards ordinary input to the backend", () => {
    const h = createHarness();

    h.controller.handleData("a");

    expect(h.sent).toEqual(["a"]);
    expect(h.echoed).toEqual([]);
  });

  it("copies selection instead of sending Ctrl+C", () => {
    const h = createHarness();
    h.setSelection("selected text");

    h.controller.handleData(CTRL_C);

    expect(h.copied).toEqual(["selected text"]);
    expect(h.sent).toEqual([]);
  });

  it("arms interrupt on the first Ctrl+C without sending it", () => {
    const h = createHarness();

    h.controller.handleData(CTRL_C);

    expect(h.sent).toEqual([]);
  });

  it("sends Ctrl+C on the second press within the interrupt window", () => {
    const h = createHarness();

    h.controller.handleData(CTRL_C);
    h.advance(INTERRUPT_ARM_WINDOW_MS - 1);
    h.controller.handleData(CTRL_C);

    expect(h.sent).toEqual([CTRL_C]);
  });

  it("does not send Ctrl+C when the second press is outside the interrupt window", () => {
    const h = createHarness();

    h.controller.handleData(CTRL_C);
    h.advance(INTERRUPT_ARM_WINDOW_MS + 1);
    h.controller.handleData(CTRL_C);

    expect(h.sent).toEqual([]);
  });

  it("does not locally echo ordinary input when real PTY send fails and fallback is disabled", async () => {
    const h = createHarness();
    h.sendData.mockImplementationOnce(() => Promise.reject(new Error("pty offline")));

    const controller = createTerminalInputController({
      hasSelection: () => false,
      getSelection: () => "",
      copyText: h.copyText,
      sendData: h.sendData,
      echoLocal: h.echoLocal,
      allowEchoFallback: false,
    });

    controller.handleData("a");
    await Promise.resolve();
    await Promise.resolve();

    expect(h.echoed).toEqual([]);
  });

  it("reports send failures without local echo fallback when live PTY send fails", async () => {
    const h = createHarness();
    const onSendFailure = vi.fn();
    h.sendData.mockImplementationOnce(() => Promise.reject(new Error("pty offline")));

    const controller = createTerminalInputController({
      hasSelection: () => false,
      getSelection: () => "",
      copyText: h.copyText,
      sendData: h.sendData,
      echoLocal: h.echoLocal,
      allowEchoFallback: false,
      onSendFailure,
    });

    controller.handleData("a");
    await Promise.resolve();
    await Promise.resolve();

    expect(h.echoed).toEqual([]);
    expect(onSendFailure).toHaveBeenCalledWith("a", expect.any(Error));
  });

  it("keeps local echo fallback when explicitly enabled", async () => {
    const h = createHarness();
    h.sendData.mockImplementationOnce(() => Promise.reject(new Error("demo mode")));

    const controller = createTerminalInputController({
      hasSelection: () => false,
      getSelection: () => "",
      copyText: h.copyText,
      sendData: h.sendData,
      echoLocal: h.echoLocal,
      allowEchoFallback: true,
    });

    controller.handleData("a");
    await Promise.resolve();
    await Promise.resolve();

    expect(h.echoed).toEqual(["a"]);
  });
});

// ===== 批3 §8：Ctrl+K 与终端输入隔离 =====
// 全局快捷键在 xterm 聚焦时必须放行给终端（node 环境，结构化伪元素即可）。

function fakeElement(options: {
  classes?: string[];
  insideXterm?: boolean;
}): { classList: { contains(token: string): boolean }; closest: (selector: string) => unknown } {
  const classes = new Set(options.classes ?? []);
  return {
    classList: { contains: (token: string) => classes.has(token) },
    closest: (selector: string) =>
      selector === ".xterm" && options.insideXterm ? {} : null,
  };
}

describe("isTerminalFocusedElement", () => {
  it("returns false for a missing focus target", () => {
    expect(isTerminalFocusedElement(null)).toBe(false);
    expect(isTerminalFocusedElement(undefined)).toBe(false);
  });

  it("returns false for ordinary focused elements", () => {
    expect(isTerminalFocusedElement(fakeElement({ classes: ["search-input"] }))).toBe(false);
  });

  it("detects the xterm helper textarea by class", () => {
    expect(
      isTerminalFocusedElement(fakeElement({ classes: ["xterm-helper-textarea"] }))
    ).toBe(true);
  });

  it("detects any element nested inside an .xterm host", () => {
    expect(isTerminalFocusedElement(fakeElement({ insideXterm: true }))).toBe(true);
  });
});
