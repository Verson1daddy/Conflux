// ===== 终端 PTY 事件 payload（终端域类型，agent 无关）=====
// 对应后端 ConfluxEvent::PtyOutput / ProcessExited 的 wire 形态。
// 单一真源在此；conflux 的 types/events.ts 经再导出消费（避免双份漂移）。

/** PTY 原始输出事件 payload（data 为 base64 编码）。 */
export interface PtyOutputPayload {
  /** 输出来源实例 ID */
  instance_id: string;
  /** base64 编码的原始输出数据 */
  data: string;
  /** per-pane 单调序号（mux +seq：连续性对账 / 重放；旧事件可空） */
  seq?: number | null;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** PTY 子进程退出事件 payload。 */
export interface ProcessExitedPayload {
  /** 退出的实例 ID */
  instance_id: string;
  /** 所属 adapter ID（Restart 时复用；shell 模式后端 respawn 后写 "__shell__"） */
  adapter_id: string;
  /** 退出码；null = 无法获取 */
  exit_code: number | null;
  /** 信号描述："pipe_broken" | null（null = 正常退出） */
  signal: string | null;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}
