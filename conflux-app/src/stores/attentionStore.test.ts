import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AttentionItem } from "@/types/interaction";

// mock IPC + 事件订阅，避免触达真实 Tauri
const listAttentionItems = vi.fn();
const listDeferredAttentionItems = vi.fn();
const onAttentionUpdated = vi.fn();
vi.mock("@/lib/tauri-bridge", () => ({
  listAttentionItems: (...a: unknown[]) => listAttentionItems(...a),
  listDeferredAttentionItems: (...a: unknown[]) => listDeferredAttentionItems(...a),
}));
vi.mock("@/lib/event-listener", () => ({
  onAttentionUpdated: (...a: unknown[]) => onAttentionUpdated(...a),
}));

import { useAttentionStore, activeItems, activeByKind } from "./attentionStore";

function item(partial: Partial<AttentionItem>): AttentionItem {
  return {
    attention_item_id: partial.attention_item_id ?? "a1",
    instance_id: partial.instance_id ?? "inst-1",
    kind: partial.kind ?? "permission",
    priority: partial.priority ?? "Critical",
    source_event_id: partial.source_event_id ?? null,
    interaction_id: partial.interaction_id ?? null,
    payload_summary: partial.payload_summary ?? "需要权限",
    available_actions: partial.available_actions ?? ["approve", "deny"],
    jump_back_target_id: partial.jump_back_target_id ?? null,
    created_at: partial.created_at ?? 1000,
    resolved_at: partial.resolved_at ?? null,
    resolution: partial.resolution ?? null,
    audit_event_id: partial.audit_event_id ?? null,
    permission_context: partial.permission_context ?? null,
    timeout_seconds: partial.timeout_seconds ?? null,
    remind_at: partial.remind_at ?? null,
    signal_source: partial.signal_source ?? null,
  };
}

beforeEach(() => {
  listAttentionItems.mockReset();
  listDeferredAttentionItems.mockReset();
  listDeferredAttentionItems.mockResolvedValue([]);
  onAttentionUpdated.mockReset();
  useAttentionStore.setState({ items: [], deferredItems: [], hydrated: false });
});

describe("attentionStore selectors", () => {
  it("activeItems 只保留 resolution===null", () => {
    const items = [
      item({ attention_item_id: "a", resolution: null }),
      item({ attention_item_id: "b", resolution: "approved", resolved_at: 2000 }),
    ];
    expect(activeItems(items).map((i) => i.attention_item_id)).toEqual(["a"]);
  });

  it("activeByKind permission 只取权限类活跃项", () => {
    const items = [
      item({ attention_item_id: "p", kind: "permission" }),
      item({ attention_item_id: "e", kind: "error_recovery" }),
      item({ attention_item_id: "p2", kind: "permission", resolution: "denied" }),
    ];
    expect(activeByKind(items, "permission").map((i) => i.attention_item_id)).toEqual([
      "p",
    ]);
  });
});

describe("attentionStore.replaceFromBackend", () => {
  it("整体替换 items 并置 hydrated", () => {
    const items = [item({ attention_item_id: "x" })];
    useAttentionStore.getState().replaceFromBackend(items);
    expect(useAttentionStore.getState().items).toEqual(items);
    expect(useAttentionStore.getState().hydrated).toBe(true);
  });
});

describe("attentionStore.start", () => {
  it("重放 list_attention_items 并订阅 attention_updated，推送时整体替换", async () => {
    const replayed = [item({ attention_item_id: "r" })];
    listAttentionItems.mockResolvedValue(replayed);
    const unlisten = vi.fn();
    let pushed: ((items: AttentionItem[]) => void) | null = null;
    onAttentionUpdated.mockImplementation(
      (cb: (items: AttentionItem[]) => void) => {
        pushed = cb;
        return Promise.resolve(unlisten);
      }
    );

    const stop = await useAttentionStore.getState().start();

    expect(listAttentionItems).toHaveBeenCalledOnce();
    expect(useAttentionStore.getState().items).toEqual(replayed);
    expect(useAttentionStore.getState().hydrated).toBe(true);

    // 后端推送新快照 → store 整体替换
    const updated = [
      item({ attention_item_id: "u" }),
      item({ attention_item_id: "u2" }),
    ];
    pushed!(updated);
    expect(useAttentionStore.getState().items).toEqual(updated);

    stop();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("start 重放 deferred 投影，且每次 attention_updated 后随手重查（spec §4.2）", async () => {
    const deferred = [
      item({ attention_item_id: "d1", resolution: "deferred", remind_at: 2_000 }),
    ];
    listAttentionItems.mockResolvedValue([]);
    listDeferredAttentionItems.mockResolvedValue(deferred);
    let pushed: ((items: AttentionItem[]) => void) | null = null;
    onAttentionUpdated.mockImplementation(
      (cb: (items: AttentionItem[]) => void) => {
        pushed = cb;
        return Promise.resolve(vi.fn());
      }
    );

    await useAttentionStore.getState().start();
    // 微任务排空（refreshDeferred 是 fire-and-forget promise）
    await Promise.resolve();
    expect(useAttentionStore.getState().deferredItems).toEqual(deferred);
    expect(listDeferredAttentionItems).toHaveBeenCalledTimes(1);

    pushed!([]);
    await Promise.resolve();
    expect(listDeferredAttentionItems).toHaveBeenCalledTimes(2);
  });

  it("后端 / 事件总线不可用时退化为 hydrated 空，不抛", async () => {
    listAttentionItems.mockRejectedValue(new Error("no backend"));
    onAttentionUpdated.mockRejectedValue(new Error("no bus"));

    const stop = await useAttentionStore.getState().start();

    expect(useAttentionStore.getState().items).toEqual([]);
    expect(useAttentionStore.getState().hydrated).toBe(true);
    expect(() => stop()).not.toThrow();
  });
});
