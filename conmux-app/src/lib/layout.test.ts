import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetLayoutForTest,
  collectSessionIds,
  computeDividers,
  computeRects,
  findLeafPath,
  getLayout,
  hasSession,
  leaf,
  MIN_RATIO,
  navigate,
  navigateFocus,
  reconcile,
  removeSession,
  replaceLeafSession,
  resizeFocused,
  resizeFocusedSplit,
  resizeSplitByPath,
  setRatioAtPath,
  split,
  splitFocused,
  splitLeaf,
  toggleZoom,
  type PaneNode,
} from "./layout";

describe("layout pure ops", () => {
  it("leaf + collect + hasSession", () => {
    const t = leaf("s1");
    expect(collectSessionIds(t)).toEqual(["s1"]);
    expect(hasSession(t, "s1")).toBe(true);
    expect(hasSession(t, "s2")).toBe(false);
    expect(collectSessionIds(null)).toEqual([]);
  });

  it("splitLeaf 竖切：目标叶变 split{v, 原, 新}", () => {
    const t = splitLeaf(leaf("s1"), "s1", "v", "s2");
    expect(t.type).toBe("split");
    expect(collectSessionIds(t)).toEqual(["s1", "s2"]);
    if (t.type === "split") expect(t.dir).toBe("v");
  });

  it("splitLeaf 对不存在的目标 = 原样返回", () => {
    const t = splitLeaf(leaf("s1"), "nope", "v", "s2");
    expect(collectSessionIds(t)).toEqual(["s1"]);
  });

  it("递归 split：可对已分裂的某叶再切", () => {
    let t: PaneNode = leaf("s1");
    t = splitLeaf(t, "s1", "v", "s2"); // s1 | s2
    t = splitLeaf(t, "s2", "h", "s3"); // s2 上下切成 s2/s3
    expect(collectSessionIds(t)).toEqual(["s1", "s2", "s3"]);
  });

  it("removeSession 塌缩父分叉到兄弟", () => {
    let t: PaneNode | null = splitLeaf(leaf("s1"), "s1", "v", "s2");
    t = removeSession(t, "s2");
    expect(t).toEqual(leaf("s1")); // 塌缩回单叶
  });

  it("removeSession 移除唯一叶 → null", () => {
    expect(removeSession(leaf("s1"), "s1")).toBeNull();
  });

  it("removeSession 三叶移中间正确塌缩", () => {
    let t: PaneNode | null = leaf("s1");
    t = splitLeaf(t, "s1", "v", "s2");
    t = splitLeaf(t, "s2", "v", "s3"); // s1 | (s2 | s3)
    t = removeSession(t!, "s2");
    expect(collectSessionIds(t)).toEqual(["s1", "s3"]);
  });

  it("replaceLeafSession swap 焦点叶内容", () => {
    const t = replaceLeafSession(leaf("s1"), "s1", "s9");
    expect(collectSessionIds(t)).toEqual(["s9"]);
  });

  it("computeRects 单叶 = 全屏", () => {
    const r = computeRects(leaf("s1"));
    expect(r.get("s1")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("computeRects 竖切 = 左右各半", () => {
    const t = splitLeaf(leaf("s1"), "s1", "v", "s2");
    const r = computeRects(t);
    expect(r.get("s1")).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(r.get("s2")).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it("computeRects 横切 = 上下各半", () => {
    const t = splitLeaf(leaf("s1"), "s1", "h", "s2");
    const r = computeRects(t);
    expect(r.get("s1")).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(r.get("s2")).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it("computeRects 嵌套：s1 | (s2/s3 上下)", () => {
    let t: PaneNode = leaf("s1");
    t = splitLeaf(t, "s1", "v", "s2"); // s1 | s2
    t = splitLeaf(t, "s2", "h", "s3"); // 右半再上下切
    const r = computeRects(t);
    expect(r.get("s1")).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(r.get("s2")).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(r.get("s3")).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("navigate 左右：s1|s2 从 s1 向 right → s2，向 left → null", () => {
    const t = splitLeaf(leaf("s1"), "s1", "v", "s2");
    expect(navigate(t, "s1", "right")).toBe("s2");
    expect(navigate(t, "s1", "left")).toBeNull();
    expect(navigate(t, "s2", "left")).toBe("s1");
    expect(navigate(t, "s1", "up")).toBeNull();
  });

  it("navigate 上下：s1/s2 横切，从 s1 向 down → s2", () => {
    const t = splitLeaf(leaf("s1"), "s1", "h", "s2");
    expect(navigate(t, "s1", "down")).toBe("s2");
    expect(navigate(t, "s2", "up")).toBe("s1");
    expect(navigate(t, "s1", "right")).toBeNull();
  });

  it("navigate 嵌套挑正对面 pane：s1 | (s2 上/s3 下)，s1 向 right 命中上半 s2", () => {
    let t: PaneNode = leaf("s1");
    t = splitLeaf(t, "s1", "v", "s2");
    t = splitLeaf(t, "s2", "h", "s3");
    // s1 中心 y=0.5；s2 中心 y=0.25、s3 中心 y=0.75；都在右侧，错位惩罚相同
    // → 取轴向最近（同 x），横轴 |0.5-0.25|=|0.5-0.75|=0.25 相同 → 命中先遍历到的 s2。
    expect(navigate(t, "s1", "right")).toBe("s2");
  });

  it("navigate from 不在树 → null", () => {
    expect(navigate(leaf("s1"), "ghost", "right")).toBeNull();
  });
});

describe("layout 可变比例（ratio / divider / resize）", () => {
  it("split() 默认 0.5 + clamp 出界", () => {
    expect(split("v", leaf("a"), leaf("b")).ratio).toBe(0.5);
    expect(split("v", leaf("a"), leaf("b"), 0.99).ratio).toBe(1 - MIN_RATIO);
    expect(split("v", leaf("a"), leaf("b"), 0.0).ratio).toBe(MIN_RATIO);
  });

  it("computeRects 按 ratio 切（竖切 0.7）", () => {
    const t = split("v", leaf("a"), leaf("b"), 0.7);
    const r = computeRects(t);
    expect(r.get("a")).toEqual({ x: 0, y: 0, w: 0.7, h: 1 });
    expect(r.get("b")).toEqual({ x: 0.7, y: 0, w: 0.30000000000000004, h: 1 });
  });

  it("computeRects 横切 0.3 高度按比例", () => {
    const t = split("h", leaf("a"), leaf("b"), 0.3);
    const r = computeRects(t);
    expect(r.get("a")).toEqual({ x: 0, y: 0, w: 1, h: 0.3 });
    expect(r.get("b")).toEqual({ x: 0, y: 0.3, w: 1, h: 0.7 });
  });

  it("computeDividers：竖切 1 条竖线在 ratio 处", () => {
    const t = split("v", leaf("a"), leaf("b"), 0.6);
    const ds = computeDividers(t, { x: 0, y: 0, w: 1, h: 1 }, 0.01);
    expect(ds).toHaveLength(1);
    expect(ds[0].path).toEqual([]);
    expect(ds[0].dir).toBe("v");
    expect(ds[0].rect.x).toBeCloseTo(0.6 - 0.005, 6); // 中心在 0.6，厚 0.01
    expect(ds[0].rect.w).toBeCloseTo(0.01, 6);
  });

  it("computeDividers 嵌套：每个 split 一条，带路径", () => {
    let t: PaneNode = leaf("s1");
    t = splitLeaf(t, "s1", "v", "s2"); // 根 v
    t = splitLeaf(t, "s2", "h", "s3"); // b 子树 h
    const ds = computeDividers(t);
    expect(ds.map((d) => d.path)).toEqual([[], ["b"]]);
    expect(ds.map((d) => d.dir)).toEqual(["v", "h"]);
  });

  it("setRatioAtPath 更新根 + 嵌套路径 + clamp", () => {
    let t: PaneNode = leaf("s1");
    t = splitLeaf(t, "s1", "v", "s2");
    t = splitLeaf(t, "s2", "h", "s3"); // 根 v、b=h split
    t = setRatioAtPath(t, [], 0.8) as PaneNode;
    t = setRatioAtPath(t, ["b"], 0.05) as PaneNode; // clamp → MIN_RATIO
    if (t.type === "split") {
      expect(t.ratio).toBe(0.8);
      if (t.b.type === "split") expect(t.b.ratio).toBe(MIN_RATIO);
    }
  });

  it("setRatioAtPath 无效路径 = 原样", () => {
    const t = splitLeaf(leaf("s1"), "s1", "v", "s2");
    expect(setRatioAtPath(t, ["a", "a"], 0.8)).toEqual(t); // a 是叶，路径越界
  });

  it("findLeafPath：根到叶的 a/b 序列", () => {
    let t: PaneNode = leaf("s1");
    t = splitLeaf(t, "s1", "v", "s2");
    t = splitLeaf(t, "s2", "h", "s3"); // s1=[a], s2=[b,a], s3=[b,b]
    expect(findLeafPath(t, "s1")).toEqual(["a"]);
    expect(findLeafPath(t, "s2")).toEqual(["b", "a"]);
    expect(findLeafPath(t, "s3")).toEqual(["b", "b"]);
    expect(findLeafPath(t, "ghost")).toBeNull();
  });

  it("resizeFocusedSplit：v 轴 focus 在 a（左）grow → ratio 增", () => {
    const t = splitLeaf(leaf("s1"), "s1", "v", "s2"); // s1 左(a) | s2 右(b)
    const grown = resizeFocusedSplit(t, "s1", "v", true, 0.1);
    if (grown && grown.type === "split") expect(grown.ratio).toBeCloseTo(0.6, 6);
  });

  it("resizeFocusedSplit：v 轴 focus 在 b（右）grow → ratio 减（右侧变宽）", () => {
    const t = splitLeaf(leaf("s1"), "s1", "v", "s2");
    const grown = resizeFocusedSplit(t, "s2", "v", true, 0.1);
    if (grown && grown.type === "split") expect(grown.ratio).toBeCloseTo(0.4, 6);
  });

  it("resizeFocusedSplit：该轴上无 split → 原样（单 pane / 仅另一轴）", () => {
    expect(resizeFocusedSplit(leaf("s1"), "s1", "v", true)).toEqual(leaf("s1"));
    const h = splitLeaf(leaf("s1"), "s1", "h", "s2"); // 只有 h split
    expect(resizeFocusedSplit(h, "s1", "v", true)).toEqual(h); // 没 v 轴可调
  });
});

describe("layout store resize 动作", () => {
  beforeEach(() => __resetLayoutForTest());

  it("resizeFocused 调焦点 pane 宽（v 轴）", () => {
    reconcile(["s1"], "s1");
    splitFocused("s1", "v", "s2"); // 焦点 s2（右/b）
    resizeFocused("v", true, 0.1); // s2 grow → 右侧变宽 → root ratio 减到 0.4
    const tree = getLayout().tree;
    if (tree && tree.type === "split") expect(tree.ratio).toBeCloseTo(0.4, 6);
  });

  it("resizeSplitByPath 直接设根 ratio", () => {
    reconcile(["s1"], "s1");
    splitFocused("s1", "v", "s2");
    resizeSplitByPath([], 0.75);
    const tree = getLayout().tree;
    if (tree && tree.type === "split") expect(tree.ratio).toBe(0.75);
  });
});

describe("layout store (reconcile/split/navigate/zoom)", () => {
  beforeEach(() => __resetLayoutForTest());

  it("reconcile 空树 + 有会话 → 用 activeId 起单叶", () => {
    reconcile(["s1", "s2"], "s1");
    expect(getLayout().tree).toEqual(leaf("s1"));
    expect(getLayout().focusedSessionId).toBe("s1");
  });

  it("reconcile 切到未显示会话 → 焦点叶 swap（单 pane 切 tab 零回归）", () => {
    reconcile(["s1", "s2"], "s1"); // 单叶 s1
    reconcile(["s1", "s2"], "s2"); // active 切到 s2（未显示）→ swap
    expect(getLayout().tree).toEqual(leaf("s2"));
    expect(getLayout().focusedSessionId).toBe("s2");
  });

  it("split 后 swap 只换焦点叶，不动另一 pane", () => {
    reconcile(["s1"], "s1");
    splitFocused("s1", "v", "s2"); // s1 | s2，焦点 s2
    reconcile(["s1", "s2", "s3"], "s2");
    // 在 s2（焦点）切到未显示的 s3 → 焦点叶 s2 被换成 s3，s1 不动
    reconcile(["s1", "s2", "s3"], "s3");
    expect(collectSessionIds(getLayout().tree)).toEqual(["s1", "s3"]);
    expect(getLayout().focusedSessionId).toBe("s3");
  });

  it("reconcile 剪掉已死会话并塌缩", () => {
    reconcile(["s1"], "s1");
    splitFocused("s1", "v", "s2"); // s1 | s2
    reconcile(["s1"], "s1"); // s2 死了
    expect(getLayout().tree).toEqual(leaf("s1"));
  });

  it("splitFocused 显式加 pane（leader+\\/-）", () => {
    reconcile(["s1"], "s1");
    splitFocused("s1", "v", "s2");
    expect(collectSessionIds(getLayout().tree)).toEqual(["s1", "s2"]);
    expect(getLayout().focusedSessionId).toBe("s2");
  });

  it("splitFocused 竞态鲁棒：reconcile 抢先把 prev swap 成 new 后仍切出两 pane", () => {
    // 复现真 bug：createSession 设 active=新 → reconcile 抢先 swap 焦点叶 prev→new。
    reconcile(["d"], "d"); // leaf(d)
    reconcile(["d", "n"], "n"); // 模拟 createSession：active=n 未显示 → swap → leaf(n)，d 被换出
    expect(collectSessionIds(getLayout().tree)).toEqual(["n"]); // 竞态后树里只剩 n
    splitFocused("d", "v", "n"); // 此时 prev=d 已不在树 → 锚定 n，重建 split{d, n}
    expect(collectSessionIds(getLayout().tree)).toEqual(["d", "n"]); // 正确两 pane
    expect(getLayout().focusedSessionId).toBe("n");
  });

  it("navigateFocus 移焦点并返回目标；无候选返回 null", () => {
    reconcile(["s1"], "s1");
    splitFocused("s1", "v", "s2"); // s1 | s2，焦点 s2
    expect(navigateFocus("left")).toBe("s1");
    expect(getLayout().focusedSessionId).toBe("s1");
    expect(navigateFocus("left")).toBeNull(); // s1 最左，无候选
    expect(getLayout().focusedSessionId).toBe("s1"); // 不动
  });

  it("toggleZoom 焦点 pane 全屏⇄还原", () => {
    reconcile(["s1"], "s1");
    splitFocused("s1", "v", "s2"); // 焦点 s2
    toggleZoom();
    expect(getLayout().zoomedSessionId).toBe("s2");
    toggleZoom();
    expect(getLayout().zoomedSessionId).toBeNull();
  });

  it("reconcile 缩放目标已死 → 清缩放", () => {
    reconcile(["s1"], "s1");
    splitFocused("s1", "v", "s2");
    toggleZoom(); // zoom s2
    reconcile(["s1"], "s1"); // s2 死
    expect(getLayout().zoomedSessionId).toBeNull();
  });
});
