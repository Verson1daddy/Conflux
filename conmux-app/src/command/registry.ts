// ===== conmux 命令面板动作注册表（M⑤a，F1 契约 §2）=====
//
// 一个 CommandAction = 命令面板里的一条可执行动作（会话操作 / 风格切换）。
// registry 动态构建：每次开面板读最新 sessions/styles 快照，只产出"当前真能跑"的动作
//   （诚实 §0/D-3：无会话则无 switch/close；不放 Background/Jump/Settings 假占位）。
//
// 风格动作是预览类（isPreview=true）：高亮即瞬态套用（preview），离开/关闭未执行则还原；
//   执行（run）= setStyle 持久化 + 广播。预览/还原闭环由 CommandPalette 驱动（§3/§5）。
//
// 纯前端：复用 lib/sessions（会话变更）+ lib/style（风格读取/应用/持久）+
//   terminal-core setTerminalTheme（终端半换肤）。零 Rust/conflux/observe 改动（D-5）。

import { setTerminalTheme } from "@conmux/terminal-core";
import {
  applyChromeVars,
  getCurrentStyleId,
  getStyles,
  setStyle,
  type Style,
} from "../lib/style";
import {
  createSession,
  getActiveId,
  getSessions,
  removeSession,
  setActive,
} from "../lib/sessions";

/** 命令面板单条动作（F1 §2 接口契约）。 */
export interface CommandAction {
  /** 稳定 id（data-action-id；过滤/选中 key）。 */
  id: string;
  /** 主名（行内主标题，e.g. "新建会话" / "纸感终端"）。 */
  title: string;
  /** 类别（行内灰前缀 + 参与模糊搜，e.g. "会话" | "风格"）。 */
  category: string;
  /** 右侧 tag（e.g. 当前风格 "current"）。可选。 */
  hint?: string;
  /** 预览类（风格）：高亮时调 preview() 瞬态套用，离开/未执行关闭则还原。 */
  isPreview?: boolean;
  /** 执行（⏎）：会话变更 / 风格持久化。 */
  run(): void | Promise<void>;
  /** isPreview 专用：高亮时瞬态套用（不持久、不广播 store）。 */
  preview?(): void;
}

/** 风格瞬态套用（预览 + 还原共用）：写 chrome 变量 + 喂 xterm 配对预置，不动 store currentId。 */
function applyStyleTransient(style: Style): void {
  applyChromeVars(style);
  setTerminalTheme(style.terminal_theme_id);
}

/**
 * 构建当前可执行的命令动作集（开面板时调一次，取实时快照）。
 *
 * 顺序（空 query 默认序，D-4：会话动作在前，当前风格标 current）：
 *   ① 新建会话（恒有）
 *   ② 切换 · {name}（每个非活跃会话；无则不入）
 *   ③ 关闭活跃会话（有活跃才入）
 *   ④ 各风格 select（恒有；预览类，当前风格 hint=current）
 */
export function buildCommandActions(): CommandAction[] {
  const actions: CommandAction[] = [];

  // ===== 会话动作（真能跑才入，§0/D-3 诚实）=====
  const sessions = getSessions();
  const activeId = getActiveId();

  // ① 新建会话（恒有）。createSession 返回新会话，run 契约为 void → 丢弃返回值。
  actions.push({
    id: "session:new",
    title: "新建会话",
    category: "会话",
    run: async () => {
      await createSession();
    },
  });

  // ② 切换到每个非活跃会话（有非活跃会话才入）。
  for (const s of sessions) {
    if (s.instanceId === activeId) continue;
    actions.push({
      id: `session:switch:${s.instanceId}`,
      title: `切换 · ${s.name}`,
      category: "会话",
      run: () => setActive(s.instanceId),
    });
  }

  // ③ 关闭活跃会话（有活跃会话才入）。
  if (activeId !== null) {
    const active = sessions.find((s) => s.instanceId === activeId);
    actions.push({
      id: "session:close-active",
      title: active ? `关闭活跃会话 · ${active.name}` : "关闭活跃会话",
      category: "会话",
      run: () => removeSession(activeId),
    });
  }

  // ===== 风格动作（恒有；预览类，当前风格标 current，§2/D-2）=====
  const currentStyleId = getCurrentStyleId();
  for (const style of getStyles()) {
    const isCurrent = style.id === currentStyleId;
    actions.push({
      id: `style:${style.id}`,
      title: style.name,
      category: "风格",
      hint: isCurrent ? "current" : undefined,
      isPreview: true,
      // 高亮即预览：瞬态套用（不持久、不广播）。
      preview: () => applyStyleTransient(style),
      // 执行：持久化 + 广播（useStyle 重渲；App effect 会 applyChromeVars+setTerminalTheme）。
      run: () => setStyle(style.id),
    });
  }

  return actions;
}
