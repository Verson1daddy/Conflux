// ===== IslandBar 组件 =====
// 灵动岛路由容器
// 根据 islandStore.mode 渲染对应子组件（TopIsland / Sidebar / FloatBall）
// 管理形态切换逻辑

import { type FC, useCallback, useState } from "react";
import { useIslandMode } from "@/hooks/useIslandMode";
import { TopIsland } from "./TopIsland";
import { Sidebar } from "./Sidebar";
import { FloatBall } from "./FloatBall";

/**
 * IslandBar — 灵动岛路由容器
 *
 * 根据当前 mode 渲染：
 * - "top_island" → TopIsland 胶囊 + 点击展开 Sidebar
 * - "sidebar" → Sidebar 面板
 * - "float_ball" → FloatBall 悬浮球 + 点击展开 Sidebar
 *
 * 形态切换逻辑：
 * - TopIsland 点击 → switchMode("sidebar")
 * - FloatBall 点击 → 打开侧边栏（overlay 模式，不切换 store mode）
 * - Sidebar 收起按钮 → switchMode(原始模式)
 *
 * 侧边栏在 float_ball 模式下作为 overlay 弹出，不改变底层 mode。
 */
const IslandBar: FC = () => {
  const { mode, switchMode } = useIslandMode();

  // 侧边栏可见性
  const [sidebarVisible, setSidebarVisible] = useState(false);
  // 记录展开侧边栏前的模式，收起时恢复
  const [previousMode, setPreviousMode] = useState<typeof mode>("top_island");

  // TopIsland 点击 → 展开侧边栏
  const handleTopIslandExpand = useCallback(() => {
    setPreviousMode("top_island");
    switchMode("sidebar");
    setSidebarVisible(true);
  }, [switchMode]);

  // FloatBall 点击 → 切换到侧边栏模式（必须调用后端以调整窗口大小）
  const handleFloatBallExpand = useCallback(() => {
    setPreviousMode("float_ball");
    switchMode("sidebar");
    setSidebarVisible(true);
  }, [switchMode]);

  // Sidebar 收起 → 恢复到之前的模式
  const handleSidebarCollapse = useCallback(() => {
    setSidebarVisible(false);
    switchMode(previousMode);
  }, [switchMode, previousMode]);

  return (
    <>
      {/* TopIsland：仅在 top_island 模式下渲染 */}
      {mode === "top_island" && (
        <TopIsland onExpand={handleTopIslandExpand} />
      )}

      {/* FloatBall：仅在 float_ball 模式下渲染 */}
      {mode === "float_ball" && (
        <FloatBall onExpand={handleFloatBallExpand} />
      )}

      {/* Sidebar：在 sidebar 模式 或 overlay 模式下渲染 */}
      <Sidebar
        visible={mode === "sidebar" || sidebarVisible}
        onCollapse={handleSidebarCollapse}
      />
    </>
  );
};

export { IslandBar };
