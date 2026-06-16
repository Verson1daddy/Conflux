// ===== daemon 真心跳单测（startDaemonHeartbeat）=====
//
// 单独成文件（不混进 sessions.test.ts 的纯函数纪律）：心跳触模块单例 daemonConnected +
// invoke + 定时器，需 mock @tauri-apps/api/core + fake timers。验真信号轮询语义：
//   立即拉一次 · daemon 中途死亡后续 tick 翻 false · stop() 停轮询 · 错误吞为 false 不抛。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { getDaemonConnected, startDaemonHeartbeat } from "./sessions";

describe("startDaemonHeartbeat (daemon 真心跳)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("立即轮询 is_daemon_connected 并反映 alive（从 false 基线驱动，证真翻转）", async () => {
    // L-1：先把单例驱到 false 基线（隔离前序测试 singleton 泄漏），再证 false→true 真翻转。
    invokeMock.mockResolvedValue(false);
    const seed = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(false);
    seed();
    invokeMock.mockResolvedValue(true);
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).toHaveBeenCalledWith("is_daemon_connected");
    expect(getDaemonConnected()).toBe(true);
    stop();
  });

  it("inflight 守卫：上一拉未回则跳过后续 tick（并发 ≤1）", async () => {
    // L-2：mock 一个不 resolve 的 invoke，多个 interval 过去仍只应有 1 次在途调用。
    let release: (v: boolean) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise<boolean>((r) => {
        release = r;
      }),
    );
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0); // 立即 tick：1 次调用，pending
    await vi.advanceTimersByTimeAsync(15000); // 跨 3 个 interval，但 inflight → 全跳过
    expect(invokeMock.mock.calls.length).toBe(1);
    release(true); // 放行 settle，避免悬挂
    await vi.advanceTimersByTimeAsync(0);
    stop();
  });

  it("daemon 中途死亡 → 后续 tick 把 store 翻 false", async () => {
    invokeMock.mockResolvedValue(true);
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(true);
    invokeMock.mockResolvedValue(false); // daemon 死亡 → 后端 request Err → false
    await vi.advanceTimersByTimeAsync(5000);
    expect(getDaemonConnected()).toBe(false);
    stop();
  });

  it("stop() 后不再轮询", async () => {
    invokeMock.mockResolvedValue(true);
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const callsAfterStop = invokeMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(invokeMock.mock.calls.length).toBe(callsAfterStop);
  });

  it("invoke 抛错（daemon 死 / 命令缺失）→ false 不抛", async () => {
    // 先暖到 true，确认随后能被错误翻回 false。
    invokeMock.mockResolvedValue(true);
    const warm = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(true);
    warm();
    invokeMock.mockRejectedValue(new Error("no daemon"));
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(false);
    stop();
  });
});
