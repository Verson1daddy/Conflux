// ===== session-status 派生纯函数单测（M⑤h §2）=====
//
// deriveStatusFromAware（M④ 多会话主路径）：AwareState.status → 缩点条 dot 状态。
//   running → running · idle → idle · exited → idle（干净退出显空闲；attention 仅占位，MF-3）。
// deriveSessionStatus（M② 退出兼容路径）：退出码 / 信号 → status。
// 只测不改映射逻辑。

import { describe, expect, it } from "vitest";
import {
  awareDotSignature,
  deriveSessionStatus,
  deriveStatusFromAware,
} from "./session-status";
import { initialAwareState, type AwareState } from "../observe/types";
import type { ProcessExitedPayload } from "@conmux/terminal-core";

const aware = (status: AwareState["status"]): AwareState => ({
  ...initialAwareState(),
  status,
});

// ===== F1（2026-07-03）：App 重渲门控签名 =====
// 门控判据：elapsed 每秒 tick（以及其它 App 不消费的字段变化）不得触发全 App 重渲；
// status / attention / activity 语义变化必须触发。
describe("awareDotSignature (App 重渲门控)", () => {
  it("仅 elapsedMs 变化 → 签名不变（每秒 tick 不再全 App 重渲）", () => {
    const a = { ...initialAwareState(), elapsedMs: 1000 };
    const b = { ...initialAwareState(), elapsedMs: 2000 };
    expect(awareDotSignature(a)).toBe(awareDotSignature(b));
  });

  it("App 不消费的字段（tokens/ctx/model/subagents）变化 → 签名不变", () => {
    const a = initialAwareState();
    const b: AwareState = {
      ...initialAwareState(),
      model: "claude-opus-4-8",
      tokensUsed: 123456,
      contextPct: 42,
      subagents: [{ type: "Explore", description: "x", status: "running", detail: null }],
    };
    expect(awareDotSignature(a)).toBe(awareDotSignature(b));
  });

  it("status / attention / activity 变化 → 签名各自不同（语义变化必触发）", () => {
    const base = initialAwareState();
    const sig = awareDotSignature(base);
    expect(awareDotSignature({ ...base, status: "idle" })).not.toBe(sig);
    expect(awareDotSignature({ ...base, attention: true })).not.toBe(sig);
    expect(awareDotSignature({ ...base, activity: "编辑文件" })).not.toBe(sig);
  });
});

describe("deriveStatusFromAware", () => {
  it("maps running → running", () => {
    expect(deriveStatusFromAware(aware("running"))).toBe("running");
  });

  it("maps idle → idle", () => {
    expect(deriveStatusFromAware(aware("idle"))).toBe("idle");
  });

  it("maps exited → idle (clean exit shows idle, not attention; MF-3)", () => {
    expect(deriveStatusFromAware(aware("exited"))).toBe("idle");
  });
});

describe("deriveSessionStatus", () => {
  const exit = (over: Partial<ProcessExitedPayload>): ProcessExitedPayload =>
    ({
      instance_id: "conmux-default",
      adapter_id: "pwsh",
      exit_code: null,
      signal: null,
      timestamp: 0,
      ...over,
    }) as ProcessExitedPayload;

  it("returns running when there is no exit info", () => {
    expect(deriveSessionStatus(null)).toBe("running");
  });

  it("returns idle for a clean exit (code 0)", () => {
    expect(deriveSessionStatus(exit({ exit_code: 0 }))).toBe("idle");
  });

  it("returns attention for a non-zero exit code", () => {
    expect(deriveSessionStatus(exit({ exit_code: 1 }))).toBe("attention");
  });

  it("returns attention when terminated by a signal", () => {
    expect(
      deriveSessionStatus(exit({ exit_code: null, signal: "pipe_broken" }))
    ).toBe("attention");
  });
});
