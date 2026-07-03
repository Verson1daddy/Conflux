// ===== hook relay 事件解析（G1，2026-07-03）=====
//
// relay 把 hook stdin JSON 原样按块追加（块尾补换行）；本解析**不做完整 JSON 框定**——
// 只按行匹配 `"notification_type": "<在册 attention 类型>"`。理由：
//   - 字段名与值恒在同一行内（pretty 每字段一行 / compact 整对象一行），行级正则对
//     两种形态都安全；不解析整对象就不怕跨块半截 JSON。
//   - 只认在册类型（matcher 已过滤，此处二次収束），不臆造语义。
// 已知边缘（登记）：若通知 message 文本里字面包含 `"notification_type":"permission_prompt"`
// 整串会误计一次——contrived，且后果仅是多一次 attention 脉冲（用户切到即清）。
// L-3 隐私：坏行/不匹配行直接跳过，绝不打日志（可能含对话明文）。

const ATTENTION_TYPE_RE =
  /"notification_type"\s*:\s*"(permission_prompt|idle_prompt)"/;

/** 统计新增行里 attention 级通知的条数（0 = 本批无需注意信号）。 */
export function countAttentionEvents(lines: string[]): number {
  let n = 0;
  for (const line of lines) {
    if (ATTENTION_TYPE_RE.test(line)) n += 1;
  }
  return n;
}
