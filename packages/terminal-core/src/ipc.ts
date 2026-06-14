// ===== 终端 PTY IPC 切片（conflux-app + conmux-app 双消费）=====
// 从 conflux 的 tauri-bridge.ts / event-listener.ts 抽出的"终端 PTY"子集：
// 命令（注入 / 尺寸 / 历史 / 退出探测 / 主题列表）+ 两个按实例过滤的 PTY 事件。
// 实现照搬 conflux 现有 invoke/listen 包装，参数/返回与后端 wire 契约一致。
//
// Tauri v2 参数命名：Rust 侧 snake_case，前端 invoke 必须传 camelCase
// （Tauri 自动反向 map）；本文件带参 invoke 全用 camelCase。
//
// ⚠️ 事件通道名当前是 conflux 进程内的 Tauri PTY 事件总线（"conflux://..."）。
// conmux-app 接 M② daemon IPC 时走独立事件源、不复用这两个通道（M① 的
// conmux-app demo 用 subscribeToPty=false，不订阅 PTY 事件）。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TerminalTheme } from "./theme-types";
import type { PtyOutputPayload, ProcessExitedPayload } from "./pty-types";

// ===== PTY 命令 =====

/** 向实例 stdin 注入内容（用户直接输入通道；source 由后端固定为 UserDirect）。 */
export async function injectStdin(instanceId: string, input: string): Promise<void> {
  return invoke<void>("inject_stdin", { instanceId, input });
}

/** 调整 PTY 终端尺寸（SIGWINCH-aware CLI 据此重排 TUI）。 */
export async function resizePty(
  instanceId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke<void>("resize_pty", { instanceId, cols, rows });
}

/** 拉取 PTY OutputBuffer 历史（base64），供新挂载终端重放 mount 前到达的输出。 */
export async function getPtyHistory(instanceId: string): Promise<string> {
  return invoke<string>("get_pty_history", { instanceId });
}

/** 备用退出探测（Windows ConPTY child exit 后 reader 偶不返回 EOF 时的轮询兜底）。 */
export async function isProcessExited(instanceId: string): Promise<boolean> {
  return invoke<boolean>("is_process_exited", { instanceId });
}

/** 列出 conmux 内置终端主题预置。 */
export async function listTerminalThemes(): Promise<TerminalTheme[]> {
  return invoke<TerminalTheme[]>("list_terminal_themes");
}

// ===== PTY 事件（按实例过滤）=====

const PTY_OUTPUT_CHANNEL = "conflux://pty-output";
const PROCESS_EXITED_CHANNEL = "conflux://process-exited";

/** 监听指定实例的 PTY 输出事件（data 为 base64；按 instance_id 过滤）。 */
export async function onPtyOutputForInstance(
  instanceId: string,
  callback: (payload: PtyOutputPayload) => void
): Promise<UnlistenFn> {
  return listen<PtyOutputPayload>(PTY_OUTPUT_CHANNEL, (tauriEvent) => {
    if (tauriEvent.payload.instance_id === instanceId) {
      callback(tauriEvent.payload);
    }
  });
}

/** 监听指定实例的 PTY 进程退出事件（按 instance_id 过滤）。 */
export async function onProcessExitedForInstance(
  instanceId: string,
  callback: (payload: ProcessExitedPayload) => void
): Promise<UnlistenFn> {
  return listen<ProcessExitedPayload>(PROCESS_EXITED_CHANNEL, (tauriEvent) => {
    if (tauriEvent.payload.instance_id === instanceId) {
      callback(tauriEvent.payload);
    }
  });
}
