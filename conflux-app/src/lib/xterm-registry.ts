// ===== xterm 实例注册表 =====
// jump-back 需要从组件树外滚动指定实例的终端；XtermTerminal 挂载时注册、
// 卸载时反注册。同一实例可能同时有预览/交互两个终端——后注册者覆盖
// （展开态交互终端后挂载，恰是滚动目标）。

import type { Terminal } from "@xterm/xterm";

const registry = new Map<string, Terminal>();

export function registerTerminal(instanceId: string, term: Terminal): void {
  registry.set(instanceId, term);
}

export function unregisterTerminal(instanceId: string, term: Terminal): void {
  if (registry.get(instanceId) === term) registry.delete(instanceId);
}

/**
 * 滚动到目标行（clamp 到 buffer 实际范围）。返回是否成功（实例未挂载 → false）。
 * backend_abs 行号与 xterm buffer 行存在坐标差，调用方负责"约第 N 行"标注。
 */
export function scrollTerminalToLine(instanceId: string, line: number): boolean {
  const term = registry.get(instanceId);
  if (!term) return false;
  const maxTop = Math.max(0, term.buffer.active.length - term.rows);
  term.scrollToLine(Math.max(0, Math.min(maxTop, Math.floor(line))));
  return true;
}
