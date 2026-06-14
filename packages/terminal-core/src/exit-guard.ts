// ===== exit-guard =====
// 修"重启之后继续重启"（用户实测）：respawn 后旧 pane 的 ProcessExited 事件
// 可能迟到，把刚清掉的退出态又顶回来 → 动作条复现 → 看起来在循环重启。
// 解法：respawn 时打标，随后短窗口内到达的退出信号视为陈旧丢弃。
// 真实的"重启后立刻又崩"不会被吞——轮询（2s）与窗口后的事件仍会落定退出态。

const respawnAt = new Map<string, number>();

/** respawn 发起时打标（restart/shell 都算）。 */
export function markRespawn(instanceId: string): void {
  respawnAt.set(instanceId, Date.now());
}

/** 实例销毁时清标。 */
export function clearRespawnMark(instanceId: string): void {
  respawnAt.delete(instanceId);
}

/** 退出信号是否落在 respawn 抑制窗内（陈旧，应丢弃）。 */
export function isStaleExitSignal(instanceId: string, windowMs = 3000): boolean {
  const t = respawnAt.get(instanceId);
  return t !== undefined && Date.now() - t < windowMs;
}
