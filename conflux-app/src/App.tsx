import { useState, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloseConfirmModal } from "./components/workspace/CloseConfirmModal";
import { Canvas } from "./components/workspace/Canvas";
import { TopBar } from "./components/workspace/TopBar";
import { StatusBar } from "./components/workspace/StatusBar";
import { AddAgentModal } from "./components/workspace/AddAgentModal";
import { SearchPalette } from "./components/workspace/SearchPalette";
import { SettingsPanel } from "./components/workspace/SettingsPanel";
import { ExpandedAgentCard } from "./components/workspace/ExpandedAgentCard";
import { DiscussionPanel } from "./components/workspace/DiscussionPanel";
import { SendToPanel } from "./components/workspace/SendToPanel";
import { OnboardingWizard } from "./components/workspace/OnboardingWizard";
import { QuickTour } from "./components/workspace/QuickTour";
import { FloatBall } from "./components/island/FloatBall";
import { Sidebar } from "./components/island/Sidebar";
import { NotificationTray } from "./components/island/NotificationTray";
import { useAgentInstances } from "./hooks/useAgentInstances";
import { useIslandMode } from "./hooks/useIslandMode";
import { useIsFullscreen } from "./hooks/useIsFullscreen";
import { useAgentStore } from "./stores/agentStore";
import { useIslandStore } from "./stores/islandStore";
import { onTaskCompleted, onErrorOccurred } from "./lib/event-listener";
import type { IslandMode, AgentInstanceInfo, AgentStatus } from "./types";

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
  const islandMode = useIslandStore((s) => s.mode) as IslandMode;

  const expandedCardId = useAgentStore((s) => s.expandedCardId);
  const openDiscussionWizard = useAgentStore((s) => s.openDiscussionWizard);
  const addNotification = useIslandStore((s) => s.addNotification);

  // Onboarding wizard guard — show once per fresh install
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem("conflux.onboarded.v1") === "true"
  );
  const handleOnboardingComplete = useCallback(() => setOnboarded(true), []);

  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [trayVisible, setTrayVisible] = useState(false);
  const [sendToVisible, setSendToVisible] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeModalVisible, setCloseModalVisible] = useState(false);

  // F11 — toggle OS fullscreen via Tauri window API.
  // Ctrl+K — open search palette (standard command-palette shortcut).
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        try {
          const win = getCurrentWindow();
          const isFull = await win.isFullscreen();
          await win.setFullscreen(!isFull);
        } catch { /* non-Tauri dev */ }
      }
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 订阅后端真事件生成通知（race-safe）
  useEffect(() => {
    let mounted = true;
    const unsubs: (() => void)[] = [];
    onTaskCompleted((payload) => {
      const inst = useAgentStore.getState().instances.get(payload.instance_id);
      addNotification({
        id: crypto.randomUUID(),
        level: "info",
        source_instance_id: payload.instance_id,
        source_adapter_name: inst?.adapter_name ?? "Agent",
        content: payload.summary || "Task completed",
        actions: [],
        created_at: Date.now(),
        read: false,
      });
    }).then((fn) => { if (mounted) unsubs.push(fn); else fn(); });
    onErrorOccurred((payload) => {
      const inst = useAgentStore.getState().instances.get(payload.instance_id);
      addNotification({
        id: crypto.randomUUID(),
        level: "warning",
        source_instance_id: payload.instance_id,
        source_adapter_name: inst?.adapter_name ?? "Agent",
        content: payload.error_message || "An error occurred",
        actions: [],
        created_at: Date.now(),
        read: false,
      });
    }).then((fn) => { if (mounted) unsubs.push(fn); else fn(); });
    return () => { mounted = false; unsubs.forEach((fn) => fn()); };
  }, [addNotification]);

  // Intercept native window close request (Alt+F4 / taskbar close)
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      const saved = localStorage.getItem("conflux.closeAction");
      if (saved === "tray") {
        await appWindow.hide();
      } else if (saved === "quit") {
        await appWindow.destroy();
      } else {
        setCloseModalVisible(true);
      }
    });
    return () => { unlistenPromise.then(fn => fn()); };
  }, []);

  // Handle close from custom TopBar button
  const handleClose = useCallback(() => {
    const saved = localStorage.getItem("conflux.closeAction");
    if (saved === "tray") { getCurrentWindow().hide(); }
    else if (saved === "quit") { getCurrentWindow().destroy(); }
    else { setCloseModalVisible(true); }
  }, []);

  // Handle modal confirm
  const handleCloseConfirm = useCallback(async (action: "tray" | "quit", remember: boolean) => {
    if (remember) localStorage.setItem("conflux.closeAction", action);
    setCloseModalVisible(false);
    const appWindow = getCurrentWindow();
    if (action === "tray") {
      await appWindow.hide();
    } else {
      await appWindow.destroy();
    }
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
        onClose={handleClose}
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
      <SearchPalette
        visible={searchOpen}
        onClose={handleSearchClose}
        onAddAgent={handleAddAgentOpen}
        onSettings={handleSettingsOpen}
        onDiscussion={handleDiscussionOpen}
      />
      <SettingsPanel visible={settingsOpen} onClose={handleSettingsClose} />
      <DiscussionPanel />
      {/* C2-A5 FloatBall — visible when island mode is "float_ball" */}
      {islandMode === "float_ball" && (
        <FloatBall onExpand={() => setSidebarVisible(true)} />
      )}
      {!onboarded && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
      <QuickTour
        visible={onboarded && !expandedCardId}
        onDismiss={() => {}}
        onStart={() => {}}
      />
      <CloseConfirmModal
        visible={closeModalVisible}
        onConfirm={handleCloseConfirm}
        onCancel={() => setCloseModalVisible(false)}
      />
    </div>
  );
}
