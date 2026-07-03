// ===== AwareHeader 渲染断言（P1-a 无 cwd 显式降级提示）=====
//
// 沿 subagent-replay.test.ts 先例：react-test-renderer 真组件渲染（node 环境，
// 无 jsdom）。fake observer 提供 subscribe/getSnapshot 形状（组件只消费这两个）。

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { create } from "react-test-renderer";
import type { SessionObserver } from "../observe/session-observer";
import { initialAwareState, type AwareState } from "../observe/types";
import { AwareHeader } from "./AwareHeader";

function fakeObserver(overrides: Partial<AwareState>): SessionObserver {
  const state: AwareState = { ...initialAwareState(), ...overrides };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
  } as unknown as SessionObserver;
}

describe("AwareHeader · P1-a 富观测阻断提示", () => {
  it("jsonlBlockedNoCwd=true → 渲染诚实提示（aware-jsonl-blocked）", () => {
    const r = create(
      createElement(AwareHeader, { observer: fakeObserver({ jsonlBlockedNoCwd: true }) }),
    );
    const hits = r.root.findAllByProps({ "data-testid": "aware-jsonl-blocked" });
    expect(hits.length).toBe(1);
    expect(JSON.stringify(r.toJSON())).toContain("富观测停用");
    r.unmount();
  });

  it("默认态（false）→ 不渲染提示（不打扰非阻断会话）", () => {
    const r = create(createElement(AwareHeader, { observer: fakeObserver({}) }));
    const hits = r.root.findAllByProps({ "data-testid": "aware-jsonl-blocked" });
    expect(hits.length).toBe(0);
    r.unmount();
  });
});

// G1（2026-07-03）：hook 已确证 → 深度感知标注（仅 agent 会话，诚实正向标注）。
describe("AwareHeader · G1 钩子感知标注", () => {
  it("agent 会话 + hookObserved=true → 渲染 ◆ 钩子感知", () => {
    const r = create(
      createElement(AwareHeader, {
        observer: fakeObserver({ isAgent: true, hookObserved: true }),
      }),
    );
    expect(r.root.findAllByProps({ "data-testid": "aware-hook-active" }).length).toBe(1);
    expect(JSON.stringify(r.toJSON())).toContain("钩子感知");
    r.unmount();
  });

  it("hookObserved=false（未确证）→ 不标注（不承诺、不据未亮断言不工作）", () => {
    const r = create(
      createElement(AwareHeader, { observer: fakeObserver({ isAgent: true }) }),
    );
    expect(r.root.findAllByProps({ "data-testid": "aware-hook-active" }).length).toBe(0);
    r.unmount();
  });

  it("shell 会话即便 hookObserved=true 也不标注（非 agent 无 hook 语义）", () => {
    const r = create(
      createElement(AwareHeader, {
        observer: fakeObserver({ isAgent: false, hookObserved: true }),
      }),
    );
    expect(r.root.findAllByProps({ "data-testid": "aware-hook-active" }).length).toBe(0);
    r.unmount();
  });
});
