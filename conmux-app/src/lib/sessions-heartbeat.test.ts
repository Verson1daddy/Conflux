// ===== daemon 真心跳 + 自动重连单测（startDaemonHeartbeat / tryReconnectDaemon）=====
//
// 单独成文件（不混进 sessions.test.ts 的纯函数纪律）：心跳触模块单例 daemonConnected/
// daemonGeneration/sessions + invoke + 定时器，需 mock @tauri-apps/api/core + fake timers。
// 验：立即拉一次 · alive 点亮 · 掉线自动重连（成功点亮+generation+1+会话 re-sync / 失败置
// false）· stop() 停轮询 · inflight 守卫并发 ≤1。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  getDaemonConnected,
  getDaemonGeneration,
  getSessions,
  startDaemonHeartbeat,
} from "./sessions";

/** 按命令名 mock invoke：handlers[cmd] 返回值（throw → reject）；未列命令 → undefined。 */
function setInvoke(handlers: Record<string, () => unknown>): void {
  invokeMock.mockImplementation((cmd: string) => {
    const h = handlers[cmd];
    if (!h) return Promise.resolve(undefined);
    try {
      return Promise.resolve(h());
    } catch (e) {
      return Promise.reject(e);
    }
  });
}

const sessionInfo = (id: string) => ({
  instance_id: id,
  adapter_id: "claude-code",
  exited: false,
});

describe("startDaemonHeartbeat (daemon 真心跳 + 自动重连)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("alive → 点亮（从 false 基线驱动证真翻转）", async () => {
    setInvoke({
      is_daemon_connected: () => false,
      reconnect_daemon: () => {
        throw new Error("down");
      },
    });
    const seed = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(false);
    seed();
    setInvoke({ is_daemon_connected: () => true });
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).toHaveBeenCalledWith("is_daemon_connected");
    expect(getDaemonConnected()).toBe(true);
    stop();
  });

  it("掉线 + 重连失败 → false（不抛）", async () => {
    setInvoke({ is_daemon_connected: () => true });
    const warm = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(true);
    warm();
    setInvoke({
      is_daemon_connected: () => false,
      reconnect_daemon: () => {
        throw new Error("no daemon");
      },
    });
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(false);
    stop();
  });

  it("掉线 + 重连成功 → 点亮 + generation +1 + 会话 re-sync", async () => {
    setInvoke({ is_daemon_connected: () => true });
    const warm = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    warm();
    const genBefore = getDaemonGeneration();
    setInvoke({
      is_daemon_connected: () => false,
      reconnect_daemon: () => ({
        respawned: true,
        sessions: [sessionInfo("conmux-default")],
      }),
    });
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(true); // 重连成功 → 点亮
    expect(getDaemonGeneration()).toBe(genBefore + 1); // fresh daemon → 强制终端重挂载
    expect(getSessions().some((s) => s.instanceId === "conmux-default")).toBe(true);
    stop();
  });

  it("掉线 + 重连(survivor，未重起) → 点亮 + generation 不变（保 scrollback）", async () => {
    setInvoke({ is_daemon_connected: () => true });
    const warm = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    warm();
    const genBefore = getDaemonGeneration();
    setInvoke({
      is_daemon_connected: () => false,
      reconnect_daemon: () => ({
        respawned: false, // daemon 没死、会话仍活
        sessions: [sessionInfo("conmux-default")],
      }),
    });
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnected()).toBe(true);
    expect(getDaemonGeneration()).toBe(genBefore); // SF-2：survivor 不 bump → 不重挂载
    stop();
  });

  it("stop() 后不再轮询", async () => {
    setInvoke({ is_daemon_connected: () => true });
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const callsAfterStop = invokeMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(invokeMock.mock.calls.length).toBe(callsAfterStop);
  });

  it("inflight 守卫：上一拉未回则跳过后续 tick（并发 ≤1）", async () => {
    let release: (v: boolean) => void = () => {};
    invokeMock.mockImplementation(
      () =>
        new Promise<boolean>((r) => {
          release = r;
        }),
    );
    const stop = startDaemonHeartbeat(5000);
    await vi.advanceTimersByTimeAsync(0); // 立即 tick：1 次调用，pending
    await vi.advanceTimersByTimeAsync(15000); // 跨 3 个 interval，但 inflight → 全跳过
    expect(invokeMock.mock.calls.length).toBe(1);
    release(true); // 放行 settle
    await vi.advanceTimersByTimeAsync(0);
    stop();
  });
});
