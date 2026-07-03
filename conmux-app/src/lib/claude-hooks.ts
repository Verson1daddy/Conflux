// ===== claude Notification hook 注入构造（G1，2026-07-03）=====
//
// ground truth（spike research/claude-hooks-spike-2026-07-03，引用复核 high）：
//   - `--settings` 接受内联 JSON、仅对该会话生效；hooks 数组与用户全局**合并**不覆盖
//     （官方 settings 文档 + issue #11392 实测）——不碰不踢用户自己的 hooks。
//   - 交互 pane 可用的 attention 信号 = 在册 notification_type：`permission_prompt`
//     （等批准）+ `idle_prompt`（闲等输入）。agent_needs_input/agent_completed 仅
//     后台 `claude agents` 会话触发，对 pane 无用。
//   - relay 用 **PowerShell exec-form**（command+args 数组，不经 shell 解析）：Windows
//     必有 powershell，消掉 node 依赖；`async:true` + Notification 非阻断 → 不卡 claude。
//
// relay 语义：把 hook stdin（JSON，可能多行 pretty 格式）原样追加到 outPath 并补一个
// 换行（UTF-8 无 BOM）。**不在 relay 里解析/压缩 JSON**（面最小）；消费端按行做
// notification_type 正则计数（见 observe/hook-events.ts），字段与值恒在同一行内，
// pretty/compact 两种形态都安全。

/** PS 单引号字符串转义（`'` → `''`）。路径含撇号的用户名等边缘由此覆盖。 */
function psSingleQuote(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * 构造 `--settings` 的内联 JSON（Notification hook → PowerShell relay 追加 outPath）。
 * 纯函数（可单测：JSON 往返、exec-form 形状、路径转义）。
 */
export function buildHookSettingsArg(outPath: string): string {
  const psCommand =
    `[IO.File]::AppendAllText('${psSingleQuote(outPath)}',` +
    `[Console]::In.ReadToEnd()+[char]10,(New-Object Text.UTF8Encoding($false)))`;
  return JSON.stringify({
    hooks: {
      Notification: [
        {
          matcher: "permission_prompt|idle_prompt",
          hooks: [
            {
              type: "command",
              command: "powershell",
              args: ["-NoProfile", "-NonInteractive", "-Command", psCommand],
              async: true,
              timeout: 30,
            },
          ],
        },
      ],
    },
  });
}
