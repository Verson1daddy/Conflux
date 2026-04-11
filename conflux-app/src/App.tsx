import { useState, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Canvas } from "./components/workspace/Canvas";
import { TopBar } from "./components/workspace/TopBar";
import { StatusBar } from "./components/workspace/StatusBar";
import { AddAgentModal } from "./components/workspace/AddAgentModal";
import { SearchPalette } from "./components/workspace/SearchPalette";
import { SettingsPanel } from "./components/workspace/SettingsPanel";
import { ExpandedAgentCard } from "./components/workspace/ExpandedAgentCard";
import { DiscussionPanel } from "./components/workspace/DiscussionPanel";
import { SendToPanel } from "./components/workspace/SendToPanel";
import { Sidebar } from "./components/island/Sidebar";
import { NotificationTray } from "./components/island/NotificationTray";
import { useAgentInstances } from "./hooks/useAgentInstances";
import { useIslandMode } from "./hooks/useIslandMode";
import { useIsFullscreen } from "./hooks/useIsFullscreen";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useAgentStore } from "./stores/agentStore";
import { useIslandStore } from "./stores/islandStore";
import type { AgentInstanceInfo, AgentStatus, NotificationItem } from "./types";

// Demo 数据——模拟设计稿中的 4 张 Agent 卡片
const DEMO_AGENTS: AgentInstanceInfo[] = [
  {
    instance_id: "demo-claude-code",
    adapter_id: "claude-code",
    adapter_name: "Claude Code",
    status: "coding" as AgentStatus,
    working_dir: "D:\\Projects\\Conflux",
    is_primary_framework: true,
    created_at: Date.now() - 324_000,
  },
  {
    instance_id: "demo-codex",
    adapter_id: "codex",
    adapter_name: "Codex",
    status: "thinking" as AgentStatus,
    working_dir: "D:\\Projects\\Conflux",
    is_primary_framework: false,
    created_at: Date.now() - 107_000,
  },
  {
    instance_id: "demo-aider",
    adapter_id: "aider",
    adapter_name: "Aider",
    status: "idle" as AgentStatus,
    working_dir: "D:\\Projects\\Conflux",
    is_primary_framework: false,
    created_at: Date.now() - 500_000,
  },
  {
    instance_id: "demo-opencode",
    adapter_id: "opencode",
    adapter_name: "OpenCode",
    status: "idle" as AgentStatus,
    working_dir: "D:\\Projects\\Conflux",
    is_primary_framework: false,
    created_at: Date.now() - 61_000,
  },
];

// Cards sized at or above the MIN_CARD_W/H enforced in AgentCard (580×380)
// so the expanded back face always has room to render properly.
const DEMO_CARDS = [
  { instance_id: "demo-claude-code", position: { x: 24, y: 24 }, size: { width: 620, height: 420 }, z_index: 1 },
  { instance_id: "demo-codex", position: { x: 680, y: 24 }, size: { width: 600, height: 400 }, z_index: 2 },
  { instance_id: "demo-aider", position: { x: 24, y: 480 }, size: { width: 580, height: 380 }, z_index: 3 },
  { instance_id: "demo-opencode", position: { x: 660, y: 460 }, size: { width: 580, height: 400 }, z_index: 4 },
];

// Demo TaskCompleted 通知——模拟 3 个 agent 在不同时间完成任务后发来的消息
// 阶段 C：验证"胶囊通知态 → 托盘展开 → 回复闭环"。真 PTY 接上后这份 mock 会被替换为后端 event。
const DEMO_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "demo-notif-claude",
    level: "info",
    source_instance_id: "demo-claude-code",
    source_adapter_name: "Claude Code",
    content:
      "Refactored the auth middleware. Session tokens now use RS256 JWTs with 1h TTL. Modified 3 files: src/middleware/auth.ts, src/lib/jwt.ts, src/types/session.ts. All 47 tests pass. Want me to also update the login endpoint, or wrap up here?",
    actions: [],
    created_at: Date.now() - 12_000,
    read: false,
  },
  {
    id: "demo-notif-codex",
    level: "warning",
    source_instance_id: "demo-codex",
    source_adapter_name: "Codex",
    content:
      "Analyzed 14 files in src/lib/. Found 3 optimization targets — hot path in parser.ts (O(n²) → O(n log n)), redundant JSON serialization in cache.ts, and unnecessary async/await chain in api-client.ts. Implement now or investigate further?",
    actions: [],
    created_at: Date.now() - 60_000,
    read: false,
  },
  {
    id: "demo-notif-aider",
    level: "info",
    source_instance_id: "demo-aider",
    source_adapter_name: "Aider",
    content:
      "Committed to feature/user-profiles. 4 files changed (+127 −43), includes migration 0042. Ready for review. Push to origin now, or wait for you to review locally first?",
    actions: [],
    created_at: Date.now() - 180_000,
    read: false,
  },
];

/**
 * Conflux 根组件
 *
 * 单窗口架构（设计稿 1440×900）：
 * - TopBar (h:52, glass, 内嵌灵动岛胶囊)
 * - Canvas (flex-1, Agent 卡片画布)
 * - StatusBar (h:30, glass, 状态摘要)
 * - Sidebar (右侧滑出 420px 面板)
 */
export default function App() {
  const { instances, statuses } = useAgentInstances();
  useIslandMode();
  const isFullscreen = useIsFullscreen();

  const setCards = useWorkspaceStore((s) => s.setCards);
  const setInstances = useAgentStore((s) => s.setInstances);
  const expandedCardId = useAgentStore((s) => s.expandedCardId);
  const openDiscussionWizard = useAgentStore((s) => s.openDiscussionWizard);
  const addNotification = useIslandStore((s) => s.addNotification);
  const notifications = useIslandStore((s) => s.notifications);

  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [trayVisible, setTrayVisible] = useState(false);
  const [sendToVisible, setSendToVisible] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 初始化 demo 数据（后端没有真实 agent 时展示设计稿效果）
  useEffect(() => {
    if (instances.size === 0) {
      setInstances(DEMO_AGENTS);
      setCards(DEMO_CARDS);
    }
  }, [instances.size, setInstances, setCards]);

  // F11 — toggle OS fullscreen via Tauri window API.
  // Used together with useIsFullscreen so the card flip mode can be tested.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "F11") return;
      e.preventDefault();
      try {
        const win = getCurrentWindow();
        const isFull = await win.isFullscreen();
        await win.setFullscreen(!isFull);
      } catch {
        // Window API unavailable (e.g. non-Tauri dev) — ignore.
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 推送 demo 通知：延迟 1.2s 后依次推入，让胶囊态切换有动画感
  // HMR 守卫：sessionStorage 跨 HMR 持久化，避免热更新/重启重复推入。
  // 同会话内 `notifications.length > 0` 也作为第二道防线。
  useEffect(() => {
    const DEMO_PUSH_KEY = "conflux.demoNotifsPushed.v1";
    if (sessionStorage.getItem(DEMO_PUSH_KEY) === "1") return;
    if (notifications.length > 0) return;
    sessionStorage.setItem(DEMO_PUSH_KEY, "1");
    const timers: ReturnType<typeof setTimeout>[] = [];
    DEMO_NOTIFICATIONS.forEach((notif, idx) => {
      timers.push(setTimeout(() => addNotification(notif), 1200 + idx * 500));
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIslandClick = useCallback(() => {
    setSidebarVisible((v) => !v);
  }, []);

  const handleSidebarCollapse = useCallback(() => {
    setSidebarVisible(false);
  }, []);

  const handleTrayOpen = useCallback(() => setTrayVisible(true), []);
  const handleTrayClose = useCallback(() => setTrayVisible(false), []);

  const handleSendToOpen = useCallback(() => setSendToVisible(true), []);
  const handleSendToClose = useCallback(() => setSendToVisible(false), []);

  // Global Discussion wizard entry — no sourceInstanceId means "fresh start"
  const handleDiscussionOpen = useCallback(
    () => openDiscussionWizard(),
    [openDiscussionWizard]
  );

  const handleAddAgentOpen = useCallback(() => setAddAgentOpen(true), []);
  const handleAddAgentClose = useCallback(() => setAddAgentOpen(false), []);
  const handleSearchOpen = useCallback(() => setSearchOpen(true), []);
  const handleSearchClose = useCallback(() => setSearchOpen(false), []);
  const handleSettingsOpen = useCallback(() => setSettingsOpen(true), []);
  const handleSettingsClose = useCallback(() => setSettingsOpen(false), []);

  // 构建 Canvas 需要的 Map
  const agentMap = new Map<string, AgentInstanceInfo>();
  instances.forEach((info, id) => agentMap.set(id, info));

  const statusMap = new Map<string, AgentStatus>();
  statuses.forEach((status, id) => statusMap.set(id, status));

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden canvas-gradient">
      <TopBar
        onIslandClick={handleIslandClick}
        onTrayOpen={handleTrayOpen}
        onSendToOpen={handleSendToOpen}
        onDiscussionOpen={handleDiscussionOpen}
        onAddAgent={handleAddAgentOpen}
        onSearch={handleSearchOpen}
        onSettings={handleSettingsOpen}
      />
      <div className="flex-1 min-h-0 relative">
        <Canvas
          agents={agentMap}
          agentStatuses={statusMap}
          isFullscreen={isFullscreen}
        />
        {/* Non-fullscreen: show overlay panel.
            Fullscreen: each card flips in place via AgentCard's isFlipped. */}
        {expandedCardId && !isFullscreen && (
          <ExpandedAgentCard instanceId={expandedCardId} />
        )}
      </div>
      <StatusBar />
      <Sidebar visible={sidebarVisible} onCollapse={handleSidebarCollapse} />
      <NotificationTray visible={trayVisible} onClose={handleTrayClose} />
      <SendToPanel visible={sendToVisible} onClose={handleSendToClose} />
      <AddAgentModal visible={addAgentOpen} onClose={handleAddAgentClose} />
      <SearchPalette visible={searchOpen} onClose={handleSearchClose} />
      <SettingsPanel visible={settingsOpen} onClose={handleSettingsClose} />
      <DiscussionPanel />
    </div>
  );
}
