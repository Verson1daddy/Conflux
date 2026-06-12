// ===== scroll-position =====
// 批3 §7：讨论流 sticky-bottom 判定（审计：DiscussionPanel scroll 劫持 P2）。
// 纯函数，供 ChatroomBody 在 onScroll 时记录"用户是否仍贴底"——只有贴底
//（含松弛带）才允许新消息自动滚底；上翻阅读历史时不被劫持。

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** 距底部剩余滚动量 ≤ slackPx 即视为"贴底"。内容短于视口时恒为贴底。 */
export function isScrolledNearBottom(
  metrics: ScrollMetrics,
  slackPx: number
): boolean {
  const remaining =
    metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight);
  return remaining <= slackPx;
}
