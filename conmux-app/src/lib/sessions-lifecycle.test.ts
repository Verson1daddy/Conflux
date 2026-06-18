// ===== sessions 生命周期单测：restartSession + removeSession recordRecent 选项 =====
//
// 触及 store 单例（sessions 数组 / RECENT / activeId）+ invoke，故 mock
// @tauri-apps/api/core 并用 resetModules + 动态 import 每测拿到干净单例。
//   restartSession   — 从会话自身 launchCommand 复原新会话（成为 active）+ 移除旧退出项，
//                       且 recordRecent:false → 不往 RECENT 留痕；默认会话(无 launchCommand)起默认。
//   removeSession    — 默认入 RECENT（有 launchCommand 时）；{recordRecent:false} 时跳过。

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

/** create_session 返回自增 paneId；kill_session 解析为空。 */
function setupInvoke(): void {
  let seq = 0;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "create_session") {
      seq += 1;
      return Promise.resolve({
        instance_id: `conmux-${seq}`,
        adapter_id: "shell",
        exited: false,
      });
    }
    if (cmd === "kill_session") return Promise.resolve();
    return Promise.resolve(undefined);
  });
}

// conmux vitest 跑 node 环境（无 localStorage）；sessions.ts 内部对 localStorage 有
// try/catch 兜底，RECENT 在内存里照常工作。resetModules 保证每测拿到全新单例（recent=[]）。
beforeEach(() => {
  invokeMock.mockReset();
  vi.resetModules();
  setupInvoke();
});

/** 取 create_session 调用的 args（断言重启复原命令）。 */
function createCalls(): Array<Record<string, unknown>> {
  return invokeMock.mock.calls
    .filter((c) => c[0] === "create_session")
    .map((c) => (c[1] ?? {}) as Record<string, unknown>);
}

describe("restartSession", () => {
  it("从快捷启动会话的 launchCommand 复原新会话、移除旧项、且不入 RECENT", async () => {
    const s = await import("./sessions");
    // 起一个带命令的会话（conmux-1）。
    await s.createSession({
      name: "WSL",
      program: "wsl.exe",
      args: ["-d", "Ubuntu"],
      cwd: "/c",
    });
    expect(s.getSessions().map((e) => e.instanceId)).toEqual(["conmux-1"]);

    // 重启 → 复原起新会话（conmux-2）并移除旧。
    const created = await s.restartSession("conmux-1");
    expect(created.instanceId).toBe("conmux-2");
    expect(s.getSessions().map((e) => e.instanceId)).toEqual(["conmux-2"]);
    expect(s.getActiveId()).toBe("conmux-2");

    // 复原命令准确（program/args/cwd 透传）。
    const creates = createCalls();
    expect(creates[1]).toMatchObject({
      program: "wsl.exe",
      args: ["-d", "Ubuntu"],
      cwd: "/c",
    });
    // 旧 pane 被 kill。
    expect(invokeMock.mock.calls).toContainEqual(["kill_session", { instanceId: "conmux-1" }]);
    // 重启≠关闭：不留 RECENT。
    expect(s.getRecent()).toEqual([]);
  });

  it("默认会话（无 launchCommand）重启起一个默认 powershell 会话", async () => {
    const s = await import("./sessions");
    // 模拟默认会话：无 spec → launchCommand 缺省。
    await s.createSession();
    expect(s.getSessions()[0].launchCommand).toBeUndefined();

    await s.restartSession("conmux-1");
    const creates = createCalls();
    // 第二次 create 仍是“无程序”（默认 powershell，后端兜底）。
    expect(creates[1]).toMatchObject({ program: null, args: null, cwd: null });
    expect(s.getSessions().map((e) => e.instanceId)).toEqual(["conmux-2"]);
  });
});

describe("removeSession recordRecent", () => {
  it("默认（有 launchCommand）→ 入 RECENT", async () => {
    const s = await import("./sessions");
    await s.createSession({ name: "WSL", program: "wsl.exe", args: ["-d", "Ubuntu"] });
    await s.removeSession("conmux-1");
    expect(s.getRecent().map((r) => r.name)).toEqual(["WSL"]);
    expect(s.getSessions()).toEqual([]);
  });

  it("{recordRecent:false} → 跳过 RECENT", async () => {
    const s = await import("./sessions");
    await s.createSession({ name: "WSL", program: "wsl.exe", args: ["-d", "Ubuntu"] });
    await s.removeSession("conmux-1", { recordRecent: false });
    expect(s.getRecent()).toEqual([]);
    expect(s.getSessions()).toEqual([]);
  });
});
