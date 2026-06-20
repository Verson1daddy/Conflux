// ===== subagent 观测端到端 replay harness（任务 ③）=====
//
// 纯函数解析（extractSubagents/accumulateSubagents）已有单测覆盖；本 harness 补**端到端
// observe→state→render** 链路，且逼真——PTY 字节是**分块到达**的，一行 `● Type(描述)`
// 可能跨两次读取被劈开。harness 把 fixture 字节**逐块**喂给 SessionObserver.feedChunk
// （走真 stripAnsi/registry/extractSubagents/accumulateSubagents 链路，**不 fake parser**），
// 断言最终 AwareState.subagents + SubagentTree 渲染。
//
// 无 Tauri/无 PTY/无 ConPTY 依赖：feedChunk 是 SessionObserver 为可测性抽出的 public 入口
// （onOutput 解码 base64 后委托它，原 Tauri 订阅路径零变）。harness 不调 start()——无需
// Tauri 事件 / 定时器；feedChunk 独立可用（JSONL 源因 started=false 自动 no-op）。

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { create } from "react-test-renderer";
import { SessionObserver } from "./session-observer";
import type { AwareState, SubagentNode } from "./types";
import { SubagentTree } from "../chrome/SubagentTree";

// ---- fixture 格式（录制字节 + 分块元信息）----
//
// 录制字节按真实 PTY 读取分块。手写 fixture 用明文 UTF-8（data 直接是文本）；真录制存
// base64（base64=true，replay 前 atob + TextDecoder 解码为 UTF-8）。seq/delayMs 是抓包
// 溯源元数据（replay **不依赖**——harness 是确定性的，不模拟实时延迟；保留字段让真录制
// 能携带时间戳/序号便于排障，replay 只取 data）。
//
// 为什么比 mock parser 更可信：mock 只验证「给定解析结果，状态正确」——跳过了 stripAnsi
// 跨块拼接、registry 嗅探升级、extractSubagents 正则、accumulateSubagents 累计等真实
// 路径。本 harness 喂的是**原始字节**，走的是**真模块**，能在「行被切断」这种 parser
// 单测触及不到的边界上抓出回归（strippedBuffer 跨块累加是正确性的关键，见用例 ③）。
//
// 怎么从真 claude 会话录一份：在 conmux-app 的 onPtyOutputForInstance 回调里把每块的
// base64 payload + Date.now() 时间戳落盘成 JSON（{data, seq, delayMs}），即得本格式 fixture。
// replay 时 base64=true 直接喂入——与生产路径同源（生产也是 base64 → decode → feedChunk）。
interface FixtureChunk {
  /** 块字节。手写 = UTF-8 文本；真录制 = base64（base64=true 时）。 */
  data: string;
  /** true → data 是 base64，replay 前 decode 为 UTF-8。缺省 false（明文）。 */
  base64?: boolean;
  /** 抓包序号（溯源用，replay 不依赖）。 */
  seq?: number;
  /** 相对延迟 ms（抓包时间戳，溯源用，replay 不依赖）。 */
  delayMs?: number;
}

interface ReplayFixture {
  name: string;
  chunks: FixtureChunk[];
  /** 期望最终 AwareState.subagents（只断言 type/description/status/detail 四字段）。 */
  expected: Array<Pick<SubagentNode, "type" | "description" | "status" | "detail">>;
}

/** base64 → UTF-8 文本（与 SessionObserver.decodeBase64Utf8 同口径，供 base64 fixture 用）。 */
function decodeBase64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** UTF-8 文本 → base64（测试 setup 用：构造 base64 fixture 块）。 */
function encodeUtf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** 逐块喂入 SessionObserver（走真 feedChunk 链路），返回最终 AwareState。 */
function replay(observer: SessionObserver, chunks: FixtureChunk[]): AwareState {
  for (const c of chunks) {
    const text = c.base64 ? decodeBase64ToUtf8(c.data) : c.data;
    observer.feedChunk(text);
  }
  return observer.getSnapshot();
}

/** 新建 observer（不 start——无需 Tauri/定时器；feedChunk 独立可用）。 */
function newObserver(): SessionObserver {
  return new SessionObserver("replay-fixture");
}

/** 只取四字段做相等比较（historic 是 provenance 标记，单独断言）。 */
const pick4 = (n: SubagentNode): Pick<SubagentNode, "type" | "description" | "status" | "detail"> => ({
  type: n.type,
  description: n.description,
  status: n.status,
  detail: n.detail,
});

// claude 嗅探标记（每个 fixture 首块必含，触发 registry 真升级到 claude parser；否则
// shell parser 不提 subagents）。用 ground-truth banner 行 "Using Opus 4.8 (1M context)"
// （claude.ts 注释标注的 v2.1.177 真打印，sniffClaude 命中 MODEL_FAMILY_RE）。
const SNIFF_BANNER = "Using Opus 4.8 (1M context)\n";

// ---- 核心 fixture（①②③④ + ⑤ ANSI）----
const FIXTURES: ReplayFixture[] = [
  {
    name: "① 单个派发 → running + 无 detail",
    chunks: [
      { data: SNIFF_BANNER, seq: 0 },
      { data: "● Explore(List files in current folder)\n   ⎿  Initializing…\n", seq: 1 },
    ],
    expected: [
      { type: "Explore", description: "List files in current folder", status: "running", detail: null },
    ],
  },
  {
    name: "② 派发 + Done 折叠行 → done 粘性 + detail（折叠行跨块到达）",
    chunks: [
      { data: SNIFF_BANNER, seq: 0 },
      { data: "● Explore(List files in current folder)\n", seq: 1 },
      { data: "   ⌊ Done (1 tool use · 18.9k tokens · 16s)\n", seq: 2 },
    ],
    expected: [
      { type: "Explore", description: "List files in current folder", status: "done", detail: "Done (1 tool use · 18.9k tokens · 16s)" },
    ],
  },
  {
    name: "③ 跨分块边界劈开的行：● Expl | ore(找文件) 仍正确累计",
    // 重点用例：派发行被劈成两块。strippedBuffer 跨块累加 → 第二块到达后行拼回 → 命中。
    chunks: [
      { data: SNIFF_BANNER, seq: 0 },
      { data: "● Expl", seq: 1 }, // 行首半截，无 ( → 本块解析为空
      { data: "ore(找文件)\n   ⎿  Initializing…\n", seq: 2 }, // 行尾半截 + 折叠行
    ],
    expected: [
      { type: "Explore", description: "找文件", status: "running", detail: null },
    ],
  },
  {
    name: "④ 工具行（Bash/Read）被正确排除，仅留 subagent",
    chunks: [
      { data: SNIFF_BANNER, seq: 0 },
      { data: "● Explore(List files in current folder)\n   ⎿  Initializing…\n", seq: 1 },
      { data: "● Bash(ls -la /c/Users/zwm)\n   ⎿  total 320\n", seq: 2 },
      { data: "● Read(CLAUDE.md)\n   ⎿  read 80 lines\n", seq: 3 },
    ],
    expected: [
      { type: "Explore", description: "List files in current folder", status: "running", detail: null },
    ],
  },
  {
    name: "⑤ ANSI 色码包裹的派发行：stripAnsi 后仍命中（走真剥离链路）",
    // \x1b[36m ... \x1b[0m 包裹——stripAnsi 剥离 CSI 后 → "● Explore(scan repo)\n"。
    // 用 \x1b 转义（非裸 ESC 字节），满足「0 个裸控制字符」。
    chunks: [
      { data: SNIFF_BANNER, seq: 0 },
      { data: "\x1b[36m● Explore(scan repo)\x1b[0m\n   ⎿  Working…\n", seq: 1 },
    ],
    expected: [
      { type: "Explore", description: "scan repo", status: "running", detail: null },
    ],
  },
];

describe("subagent observe→state replay harness", () => {
  describe.each(FIXTURES)("fixture: $name", (f) => {
    it("replay → expected subagents（走真 feedChunk 链路）", () => {
      const s = replay(newObserver(), f.chunks);
      expect(s.subagents.map(pick4)).toEqual(f.expected);
      // 结构性断言（不依赖具体 fixture 内容）：升级到 claude + 实时（非 historic）。
      expect(s.isAgent).toBe(true);
      expect(s.parserId).toBe("claude");
      for (const n of s.subagents) expect(n.historic).toBe(false);
    });
  });

  it("③ 补充：跨块切断的中间态——半截行不应误出 subagent", () => {
    // 喂完 banner + 半截派发行后，subagents 必须仍为 []（行未完整，正则不中）。
    const o = newObserver();
    o.feedChunk(SNIFF_BANNER);
    o.feedChunk("● Expl");
    expect(o.getSnapshot().subagents).toEqual([]);
    // 喂完行尾半截后才出现。
    o.feedChunk("ore(找文件)\n   ⎿  Initializing…\n");
    expect(o.getSnapshot().subagents).toHaveLength(1);
  });

  it("⑥ base64 fixture 块：解码后等价明文（真录制接入路径）", () => {
    // 证明 base64=true 的块经 decode 后与明文等价——真录制（base64 抓包）可直接填充。
    const plain = "● Plan(design the migration)\n   ⎿  Initializing…\n";
    const s = replay(newObserver(), [
      { data: encodeUtf8ToBase64(SNIFF_BANNER), base64: true, seq: 0 },
      { data: encodeUtf8ToBase64(plain), base64: true, seq: 1 },
    ]);
    expect(s.subagents.map(pick4)).toEqual([
      { type: "Plan", description: "design the migration", status: "running", detail: null },
    ]);
  });
});

// ---- SubagentTree 渲染断言（observe→state→render 末端）----
//
// 真组件渲染：react-test-renderer（任务预授权的 dev-only 依赖；client 风格渲染器，不走
// SSR 路径故 useSyncExternalStore 无需 getServerSnapshot，且不依赖 jsdom——在 node 环境跑
// 真 SubagentTree）。用 findAllByProps 断言 data-* 属性、toJSON 断言文本（CSS 变量无 DOM
// 不解析，但属性/文本恒在）。
describe("SubagentTree 渲染（observe→state→render 末端）", () => {
  it("非空 subagents → 渲染树 + 行，带 data-type/data-status", () => {
    const observer = newObserver();
    replay(observer, [
      { data: SNIFF_BANNER },
      { data: "● Explore(List files in current folder)\n   ⎿  Initializing…\n" },
    ]);
    const root = create(createElement(SubagentTree, { observer })).root;
    expect(root.findAllByProps({ "data-testid": "conmux-subagent-tree" })).toHaveLength(1);
    const rows = root.findAllByProps({ "data-testid": "conmux-subagent-row" });
    expect(rows).toHaveLength(1);
    expect(rows[0].props["data-type"]).toBe("Explore");
    expect(rows[0].props["data-status"]).toBe("running");
  });

  it("空 subagents → SubagentTree 返回 null → toJSON 为 null（无树/无行）", () => {
    const observer = newObserver();
    observer.feedChunk(SNIFF_BANNER); // 升级到 claude 但无派发行 → subagents 仍 []
    const tree = create(createElement(SubagentTree, { observer })).toJSON();
    expect(tree).toBeNull();
  });

  it("done 节点 → data-status=done + detail 度量文本（剥 Done( 壳）", () => {
    const observer = newObserver();
    replay(observer, [
      { data: SNIFF_BANNER },
      { data: "● Explore(scan)\n   ⌊ Done (1 tool use · 16s)\n" },
    ]);
    const renderer = create(createElement(SubagentTree, { observer }));
    const rows = renderer.root.findAllByProps({ "data-testid": "conmux-subagent-row" });
    expect(rows[0].props["data-status"]).toBe("done");
    // stripDoneShell 剥 "Done(" 壳 → "1 tool use · 16s" 出现在渲染文本里。
    expect(JSON.stringify(renderer.toJSON())).toContain("1 tool use · 16s");
  });
});
