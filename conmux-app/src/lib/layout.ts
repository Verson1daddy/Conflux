// ===== 分屏布局（tmux 式同屏 pane）=====
//
// 模型：一棵二叉布局树，叶子 = 一个会话(sessionId)，分叉 = 方向(v/h) + 两个子树(固定 50/50)。
//   dir "v" = 竖向分隔线 → 左右并排；dir "h" = 横向分隔线 → 上下堆叠（与 tmux 直觉一致：
//   `leader+\` 竖切得左右、`leader+-` 横切得上下）。
//
// 与会话模型的关系（v1，刻意非回归）：
//   - 缩点条仍是"所有会话"的列表；布局树的叶子是其中"当前显示"的子集。
//   - **只有 leader+\ / leader+- 显式加 pane**（split 焦点叶 → spawn 新会话占新叶）。
//   - **其余激活动作（+按钮 / 点会话点 / leader n·p·数字 / Home 启动）= 在焦点 pane 里换会话**
//     （swap，不加 pane）：单 pane 时 swap 焦点叶 == 今天的"切 tab / 新会话全屏"，零回归。
//   - 焦点叶的 sessionId 与 sessions.activeId 保持一致（App 两边同步调用维持不变量）。
//   - 渲染走 mount-all：所有会话的 XtermTerminal 恒挂载（key=instanceId 不重连）；本模块只给出
//     每个"显示中"会话的矩形(分数 0..1)，App 据此绝对定位；不在布局里的会话 display:none。
//     pane 尺寸变 → XtermTerminal 自带 ResizeObserver 自动 fit + resizePty（无需本模块管）。
//
// 纯函数（split/remove/computeRects/navigate）导出供 vitest；下方薄 store 供 App 订阅。

export interface LeafNode {
  type: "leaf";
  sessionId: string;
}
export interface SplitNode {
  type: "split";
  /** "v" 竖分隔=左右；"h" 横分隔=上下。 */
  dir: "v" | "h";
  a: PaneNode;
  b: PaneNode;
}
export type PaneNode = LeafNode | SplitNode;

/** 矩形（分数坐标 0..1，相对 body）。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NavDir = "left" | "right" | "up" | "down";

export function leaf(sessionId: string): LeafNode {
  return { type: "leaf", sessionId };
}

/** 树内所有 sessionId（DFS 顺序）。 */
export function collectSessionIds(node: PaneNode | null): string[] {
  if (!node) return [];
  if (node.type === "leaf") return [node.sessionId];
  return [...collectSessionIds(node.a), ...collectSessionIds(node.b)];
}

export function hasSession(node: PaneNode | null, sessionId: string): boolean {
  return collectSessionIds(node).includes(sessionId);
}

/**
 * 把 targetSessionId 所在叶分裂为 split{dir, a:原叶, b:新叶(newSessionId)}。
 * target 不在树中 → 原样返回（不分裂，防误操作）。
 */
export function splitLeaf(
  node: PaneNode,
  targetSessionId: string,
  dir: "v" | "h",
  newSessionId: string
): PaneNode {
  if (node.type === "leaf") {
    if (node.sessionId !== targetSessionId) return node;
    return { type: "split", dir, a: leaf(node.sessionId), b: leaf(newSessionId) };
  }
  return {
    ...node,
    a: splitLeaf(node.a, targetSessionId, dir, newSessionId),
    b: splitLeaf(node.b, targetSessionId, dir, newSessionId),
  };
}

/**
 * 移除 sessionId 的叶并塌缩其父分叉为兄弟子树。
 * 若该叶是整棵树 → 返回 null（无显示会话）。sessionId 不在树中 → 原样返回。
 */
export function removeSession(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === "leaf") {
    return node.sessionId === sessionId ? null : node;
  }
  const a = removeSession(node.a, sessionId);
  const b = removeSession(node.b, sessionId);
  if (a === null) return b; // a 子树空 → 塌缩到 b
  if (b === null) return a; // b 子树空 → 塌缩到 a
  return { ...node, a, b };
}

/** 把某叶的会话替换为另一会话（swap：焦点 pane 换显示内容）。oldSessionId 不在树中 → 原样返回。 */
export function replaceLeafSession(
  node: PaneNode,
  oldSessionId: string,
  newSessionId: string
): PaneNode {
  if (node.type === "leaf") {
    return node.sessionId === oldSessionId ? leaf(newSessionId) : node;
  }
  return {
    ...node,
    a: replaceLeafSession(node.a, oldSessionId, newSessionId),
    b: replaceLeafSession(node.b, oldSessionId, newSessionId),
  };
}

/** 计算每个会话的矩形（分数坐标）。固定 50/50 分割。 */
export function computeRects(
  node: PaneNode | null,
  container: Rect = { x: 0, y: 0, w: 1, h: 1 }
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  if (!node) return out;
  if (node.type === "leaf") {
    out.set(node.sessionId, container);
    return out;
  }
  let ra: Rect;
  let rb: Rect;
  if (node.dir === "v") {
    // 竖分隔 → 左右各半
    ra = { ...container, w: container.w / 2 };
    rb = { x: container.x + container.w / 2, y: container.y, w: container.w / 2, h: container.h };
  } else {
    // 横分隔 → 上下各半
    ra = { ...container, h: container.h / 2 };
    rb = { x: container.x, y: container.y + container.h / 2, w: container.w, h: container.h / 2 };
  }
  for (const [k, v] of computeRects(node.a, ra)) out.set(k, v);
  for (const [k, v] of computeRects(node.b, rb)) out.set(k, v);
  return out;
}

/**
 * 几何导航：从 fromSessionId 的 pane 出发，找指定方向上最近的 pane，返回其 sessionId。
 * 无候选 → null。基于 pane 中心点：方向轴上必须严格越过，按"轴向距离 + 横轴错位惩罚"取最小。
 */
export function navigate(
  node: PaneNode | null,
  fromSessionId: string,
  dir: NavDir
): string | null {
  const rects = computeRects(node);
  const from = rects.get(fromSessionId);
  if (!from) return null;
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };

  let best: string | null = null;
  let bestScore = Infinity;
  for (const [sid, r] of rects) {
    if (sid === fromSessionId) continue;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const dx = c.x - fc.x;
    const dy = c.y - fc.y;
    let along: number;
    let cross: number;
    switch (dir) {
      case "left":
        if (dx >= -1e-6) continue;
        along = -dx;
        cross = Math.abs(dy);
        break;
      case "right":
        if (dx <= 1e-6) continue;
        along = dx;
        cross = Math.abs(dy);
        break;
      case "up":
        if (dy >= -1e-6) continue;
        along = -dy;
        cross = Math.abs(dx);
        break;
      case "down":
        if (dy <= 1e-6) continue;
        along = dy;
        cross = Math.abs(dx);
        break;
    }
    // 轴向距离为主，横轴错位 ×2 惩罚（偏好正对面的 pane）。
    const score = along + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = sid;
    }
  }
  return best;
}

// ===== 薄 store（App 订阅；leader/App 调用动作）=====
//
// 不变量（reconcile 维护）：**activeId 永远显示在「焦点 pane」**——这样单 pane 时用
// digit/n/p/点会话点切到未显示会话也不会消失（swap 进焦点叶），最常见的切 tab 零回归。
// focusedSessionId 始终 === sessions.activeId（reconcile 收敛）。

interface LayoutState {
  tree: PaneNode | null;
  /** 焦点叶的会话（== sessions.activeId，reconcile 收敛）。 */
  focusedSessionId: string | null;
  /** 缩放（单 pane 全屏）的会话；null=不缩放。 */
  zoomedSessionId: string | null;
}

let state: LayoutState = { tree: null, focusedSessionId: null, zoomedSessionId: null };
const listeners = new Set<() => void>();

function setState(next: LayoutState): void {
  state = next;
  for (const l of listeners) l();
}

export function getLayout(): LayoutState {
  return state;
}
export function subscribeLayout(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 与会话列表 + activeId 对账（App effect [sessions, activeId] 调用）——单一收敛点：
 *   1. 剪掉树里已死会话叶（关闭/重连消失）。
 *   2. 树空但有会话 → 用 activeId（或第一个）起单叶。
 *   3. activeId 在树中 → 焦点移到它（不 swap）；不在树中 → 把**焦点叶**换成它（swap，
 *      保最常见"切 tab"在单/多 pane 都对）。焦点叶已死则换第一个叶。
 *   4. 缩放目标已死 → 清缩放。
 * 仅在真变化时 setState（防无谓重渲，无环——本 effect 依赖 sessions/activeId 非 layout）。
 */
export function reconcile(liveSessionIds: string[], activeId: string | null): void {
  const live = new Set(liveSessionIds);
  let tree = state.tree;
  for (const sid of collectSessionIds(tree)) {
    if (!live.has(sid)) tree = tree ? removeSession(tree, sid) : null;
  }
  let focused = state.focusedSessionId;
  if (focused && !live.has(focused)) focused = null; // 焦点已死

  if (!tree && liveSessionIds.length > 0) {
    const seed = activeId && live.has(activeId) ? activeId : liveSessionIds[0];
    tree = leaf(seed);
    focused = seed;
  }
  if (tree && activeId && live.has(activeId)) {
    if (hasSession(tree, activeId)) {
      focused = activeId; // 已显示 → 移焦点（不动树）
    } else {
      // active 未显示 → 焦点叶 swap 成它（焦点叶已死则换第一个叶）。
      const target =
        focused && hasSession(tree, focused) ? focused : collectSessionIds(tree)[0];
      if (target !== undefined) tree = replaceLeafSession(tree, target, activeId);
      focused = activeId;
    }
  }
  const zoom =
    state.zoomedSessionId && live.has(state.zoomedSessionId)
      ? state.zoomedSessionId
      : null;
  if (
    tree !== state.tree ||
    focused !== state.focusedSessionId ||
    zoom !== state.zoomedSessionId
  ) {
    setState({ tree, focusedSessionId: focused, zoomedSessionId: zoom });
  }
}

/** 把 anchorSessionId 那片叶替换为 split{dir, a, b}（splitFocused 用，竞态鲁棒）。 */
function replaceLeafWithSplit(
  node: PaneNode,
  anchorSessionId: string,
  dir: "v" | "h",
  aSession: string,
  bSession: string
): PaneNode {
  if (node.type === "leaf") {
    if (node.sessionId !== anchorSessionId) return node;
    return { type: "split", dir, a: leaf(aSession), b: leaf(bSession) };
  }
  return {
    ...node,
    a: replaceLeafWithSplit(node.a, anchorSessionId, dir, aSession, bSession),
    b: replaceLeafWithSplit(node.b, anchorSessionId, dir, aSession, bSession),
  };
}

/**
 * 分裂焦点 pane（显式加 pane，唯一加 pane 路径）：在 prevSessionId（split 前 active）所在的
 * 「焦点位置」切出 split{dir, prev, new}，焦点移到新叶。退出缩放。
 *
 * **竞态鲁棒（关键）**：App 在 `createSession` 成功后调用，但 createSession 已把 activeId 改成
 * new 并触发 reconcile——reconcile 可能**抢先**把 prev 那片焦点叶 swap 成 new（prev 被换出树）。
 * 故锚定焦点叶时：prev 还在 → 用 prev；prev 已被换成 new → 用 new；都不在 → 第一叶。无论
 * splitFocused 与 reconcile 谁先跑，结果都是正确的两 pane（prev | new）。
 */
export function splitFocused(
  prevSessionId: string,
  dir: "v" | "h",
  newSessionId: string
): void {
  const tree = state.tree;
  if (!tree) {
    setState({ tree: leaf(newSessionId), focusedSessionId: newSessionId, zoomedSessionId: null });
    return;
  }
  const anchor = hasSession(tree, prevSessionId)
    ? prevSessionId
    : hasSession(tree, newSessionId)
      ? newSessionId
      : collectSessionIds(tree)[0];
  if (anchor === undefined) {
    setState({ tree: leaf(newSessionId), focusedSessionId: newSessionId, zoomedSessionId: null });
    return;
  }
  const next = replaceLeafWithSplit(tree, anchor, dir, prevSessionId, newSessionId);
  setState({ tree: next, focusedSessionId: newSessionId, zoomedSessionId: null });
}

/**
 * 几何导航焦点：从当前焦点叶向 dir 找最近 pane，命中则更新焦点并返回其 sessionId
 * （App setActive + 聚焦终端），无候选返回 null（不动）。
 */
export function navigateFocus(dir: NavDir): string | null {
  const from = state.focusedSessionId;
  if (!from) return null;
  const target = navigate(state.tree, from, dir);
  if (target) setState({ ...state, focusedSessionId: target });
  return target;
}

/** 缩放切换：当前焦点 pane 全屏⇄还原。 */
export function toggleZoom(): void {
  const f = state.focusedSessionId;
  if (!f) return;
  setState({ ...state, zoomedSessionId: state.zoomedSessionId === f ? null : f });
}

/** 测试用：重置 store。 */
export function __resetLayoutForTest(): void {
  state = { tree: null, focusedSessionId: null, zoomedSessionId: null };
  listeners.clear();
}
