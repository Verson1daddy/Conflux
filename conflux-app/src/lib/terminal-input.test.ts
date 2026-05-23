import { describe, expect, it, vi } from "vitest";

import {
  CTRL_C,
  INTERRUPT_ARM_WINDOW_MS,
  createTerminalInputController,
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
