// ===== hook-events 解析单测（G1）=====

import { describe, expect, it } from "vitest";
import { countAttentionEvents } from "./hook-events";

describe("countAttentionEvents", () => {
  it("在册 attention 类型（permission_prompt / idle_prompt）逐条计数", () => {
    const lines = [
      '{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"Allow?"}',
      '{"hook_event_name":"Notification","notification_type":"idle_prompt","message":"waiting"}',
    ];
    expect(countAttentionEvents(lines)).toBe(2);
  });

  it("pretty 格式（字段独占一行）同样命中", () => {
    const lines = [
      "{",
      '  "hook_event_name": "Notification",',
      '  "notification_type": "permission_prompt",',
      '  "message": "Allow Bash?"',
      "}",
    ];
    expect(countAttentionEvents(lines)).toBe(1);
  });

  it("非 attention 类型（auth_success 等）与坏行 → 0（不臆造语义、不抛）", () => {
    const lines = [
      '{"notification_type":"auth_success"}',
      '{"notification_type":"elicitation_dialog"}',
      "{ not valid json",
      "",
      "plain text",
    ];
    expect(countAttentionEvents(lines)).toBe(0);
  });

  it("空批 → 0", () => {
    expect(countAttentionEvents([])).toBe(0);
  });
});
