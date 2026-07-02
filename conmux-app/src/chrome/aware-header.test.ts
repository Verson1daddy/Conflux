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
