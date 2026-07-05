// 注意力项展示格式化：TopIsland / Sidebar 共用，避免各写一份、各修一半。

/**
 * 清洗权限摘要用于展示：去掉后端拼装里 kind 与 action 相同造成的「X — X」冗余
 * （如「权限请求: Write — Write: …」→「权限请求: Write: …」），并折叠多余空格。
 */
export function formatPermissionSummary(summary: string): string {
  return summary
    .replace(/(\S+)\s*[—-]\s*\1(?=\s*[:：])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 相对时间，按量级进位到 分/时/天/周/月/年。
 *
 * 旧实现只输出「N min ago」，请求放久了会显示「32915 min ago」这种没人读得懂的
 * 数字（22 天）——这里按量级 rollup，超过一小时就不再用分钟。
 */
export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now()
): string {
  if (!timestamp || timestamp <= 0) return "just now";
  const diffMs = Math.max(0, now - timestamp);
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  if (day < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
