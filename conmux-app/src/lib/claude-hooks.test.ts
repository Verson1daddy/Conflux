// ===== claude-hooks 注入构造单测（G1）=====

import { describe, expect, it } from "vitest";
import { buildHookSettingsArg } from "./claude-hooks";

describe("buildHookSettingsArg", () => {
  const OUT = "C:\\Users\\me\\AppData\\Local\\conmux\\hooks\\abc-123.ndjson";

  it("产出合法 JSON，形状 = Notification + 在册 matcher + PowerShell exec-form", () => {
    const parsed = JSON.parse(buildHookSettingsArg(OUT));
    const entry = parsed.hooks.Notification[0];
    expect(entry.matcher).toBe("permission_prompt|idle_prompt");
    const hook = entry.hooks[0];
    expect(hook.type).toBe("command");
    expect(hook.command).toBe("powershell");
    // exec-form（args 数组存在 → 不经 shell 解析，Windows 引号地狱免疫）。
    expect(Array.isArray(hook.args)).toBe(true);
    expect(hook.args[0]).toBe("-NoProfile");
    // 非阻断：async + 有界 timeout（Notification 事件本身不可阻断，双保险）。
    expect(hook.async).toBe(true);
    expect(hook.timeout).toBe(30);
  });

  it("relay 命令包含目标路径与 UTF-8 无 BOM 追加语义", () => {
    const parsed = JSON.parse(buildHookSettingsArg(OUT));
    const cmd: string = parsed.hooks.Notification[0].hooks[0].args[3];
    expect(cmd).toContain(OUT);
    expect(cmd).toContain("AppendAllText");
    expect(cmd).toContain("UTF8Encoding($false)"); // 无 BOM。
    expect(cmd).toContain("[char]10"); // 块尾补换行（消费端行级解析依赖）。
  });

  it("路径含单引号 → PS 转义为 ''（撇号用户名边缘）", () => {
    const parsed = JSON.parse(
      buildHookSettingsArg("C:\\Users\\o'brien\\hooks\\x.ndjson"),
    );
    const cmd: string = parsed.hooks.Notification[0].hooks[0].args[3];
    expect(cmd).toContain("o''brien");
  });
});
