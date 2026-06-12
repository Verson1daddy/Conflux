// ===== JumpBackTarget 镜像（core/jumpback.rs，serde snake_case）=====
import type { InstanceId } from "./agent";

export type JumpKind = "card" | "terminal_range" | "fallback_context";
export type JumpConfidence = "high" | "medium" | "low";
export type CoordSpace = "xterm" | "backend_abs";

export interface TerminalRange {
  start_line: number;
  end_line: number;
  coord_space: CoordSpace;
}

/**
 * 精确回场对象（契约 §5.1 / §13.8）：仅 app 内部聚焦字段，结构上不含任何
 * 可驱动 shell.open / 外部 URI 的字段——前端只能做内部导航。
 *
 * 后端 get_jump_back_target 已应用消费时降级链（V1-core §4.3）：
 * pane 死 → fallback_context；行被环覆盖 → card（medium）；未知 id → 合成 fallback。
 */
export interface JumpBackTarget {
  jump_back_target_id: string;
  target_kind: JumpKind;
  instance_id: InstanceId | null;
  card_id: string | null;
  terminal_range: TerminalRange | null;
  cwd: string | null;
  fallback_summary: string | null;
  confidence: JumpConfidence;
}
