import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import "@/lib/i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  loadDiscussionReviewSnapshot,
  type DiscussionReviewSnapshot,
} from "./lib/discussion-review";
import {
  quitApplication,
  showCompactModeOnly,
} from "./lib/tauri-bridge";
import { TOP_BAR_COMPACT_MODE } from "./lib/workspace-compact-mode";
import { CloseConfirmModal } from "./components/workspace/CloseConfirmModal";
import { Canvas } from "./components/workspace/Canvas";
import { TopBar } from "./components/workspace/TopBar";
import { StatusBar } from "./components/workspace/StatusBar";
import { useAgentInstances } from "./hooks/useAgentInstances";
import { useIslandMode } from "./hooks/useIslandMode";
import { useIsFullscreen } from "./hooks/useIsFullscreen";
import { useAgentStore } from "./stores/agentStore";
import { useIslandStore } from "./stores/islandStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { onJumpBackRequested } from "./lib/event-listener";
import { dispatchJumpTarget } from "./lib/jump-back";
import { scrollTerminalToLine } from "./lib/xterm-registry";
import type { AgentInstanceInfo, AgentStatus, CloseAction } from "./types";

const AddAgentModal = lazy(() =>
  import("./components/workspace/AddAgentModal").then((module) => ({
    default: module.AddAgentModal,
  }))
);
const SearchPalette = lazy(() =>
  import("./components/workspace/SearchPalette").then((module) => ({
    default: module.SearchPalette,
  }))
);
const SettingsPanel = lazy(() =>
  import("./components/workspace/SettingsPanel").then((module) => ({
    default: module.SettingsPanel,
  }))
);
const DiscussionPanel = lazy(() =>
  import("./components/workspace/DiscussionPanel").then((module) => ({
    default: module.DiscussionPanel,
  }))
);
const DiscussionReviewModal = lazy(() =>
  import("./components/workspace/DiscussionReviewModal").then((module) => ({
    default: module.DiscussionReviewModal,
  }))
);
const SendToPanel = lazy(() =>
  import("./components/workspace/SendToPanel").then((module) => ({
    default: module.SendToPanel,
  }))
);
const ExpandedAgentCard = lazy(() =>
  import("./components/workspace/ExpandedAgentCard").then((module) => ({
    default: module.ExpandedAgentCard,
  }))
);
const SessionPlayback = lazy(() =>
  import("./components/session/SessionPlayback").then((module) => ({
    default: module.SessionPlayback,
  }))
);

export default function App() {
  const { instances, statuses } = useAgentInstances({ hydrateTrees: false });
  useIslandMode();
  const setIslandMode = useIslandStore((s) => s.setMode);
  const isFullscreen = useIsFullscreen();

  const expandedCardId = useAgentStore((s) => s.expandedCardId);
  const discussionOpen = useAgentStore((s) => s.discussion.open);
  const openDiscussionWizard = useAgentStore((s) => s.openDiscussionWizard);

  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sendToOpen, setSendToOpen] = useState(false);
  const [sessionVisible, setSessionVisible] = useState(false);
  const [discussionReviewVisible, setDiscussionReviewVisible] = useState(false);
  const [discussionReviewSnapshot, setDiscussionReviewSnapshot] =
    useState<DiscussionReviewSnapshot | null>(null);
  const [closeModalVisible, setCloseModalVisible] = useState(false);
  const quittingRef = useRef(false);

  const readSavedCloseAction = useCallback((): CloseAction | null => {
    const saved = localStorage.getItem("conflux.closeAction");
    if (
      saved === "quit" ||
      saved === "top_island" ||
      saved === "sidebar"
    ) {
      return saved;
    }
    return null;
  }, []);

  const applyCloseAction = useCallback(
    async (action: CloseAction) => {
      if (action === "quit") {
        quittingRef.current = true;
        try {
          await quitApplication();
        } catch (error) {
          quittingRef.current = false;
          throw error;
        }
        return;
      }

      setIslandMode(action);
      await showCompactModeOnly(action);
      return;
    },
    [setIslandMode]
  );

  // jump-back 主窗消费（spec §2.2）：展开/滚动/fallback 通知。
  // 视口聚焦由 Canvas 内自己监听同一事件完成（需要 live refs）。
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    onJumpBackRequested((target) => {
      dispatchJumpTarget(target, {
        showFallback: (summary) => {
          useIslandStore.getState().addNotification({
            id: `jumpback-${target.jump_back_target_id}`,
            level: "info",
            source_instance_id: target.instance_id ?? "",
            source_adapter_name: "jump-back",
            content: summary,
            actions: [{ label: "Dismiss", action_type: "dismiss" }],
            created_at: Date.now(),
            read: false,
          });
        },
        focusCard: (instanceId) => {
          // Canvas 监听同一事件做视口动画；这里只负责选中态。
          useWorkspaceStore.getState().selectCard(instanceId);
        },
        expandCard: (instanceId) => {
          useAgentStore.getState().setExpandedCard(instanceId);
        },
        scrollTerminal: (instanceId, range, approximate) => {
          useAgentStore.getState().setTerminalJumpHint({
            instanceId,
            startLine: range.start_line,
            endLine: range.end_line,
            approximate,
          });
          // 展开刚触发时交互终端可能尚未挂载（lazy + mount），重试几拍。
          let attempts = 0;
          const tryScroll = () => {
            if (scrollTerminalToLine(instanceId, range.start_line) || attempts >= 10) return;
            attempts += 1;
            setTimeout(tryScroll, 150);
          };
          tryScroll();
        },
      });
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        try {
          const win = getCurrentWindow();
          const isFull = await win.isFullscreen();
          await win.setFullscreen(!isFull);
        } catch {
          // Non-Tauri dev environment.
        }
      }
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSearchOpen((visible) => !visible);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      if (quittingRef.current) {
        return;
      }
      event.preventDefault();
      const saved = readSavedCloseAction();
      if (saved) {
        await applyCloseAction(saved);
      } else {
        setCloseModalVisible(true);
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [applyCloseAction, readSavedCloseAction]);

  const handleClose = useCallback(() => {
    const saved = readSavedCloseAction();
    if (saved) {
      void applyCloseAction(saved);
    } else {
      setCloseModalVisible(true);
    }
  }, [applyCloseAction, readSavedCloseAction]);

  const handleCloseConfirm = useCallback(
    async (action: CloseAction, remember: boolean) => {
      if (remember) {
        localStorage.setItem("conflux.closeAction", action);
      }
      setCloseModalVisible(false);
      await applyCloseAction(action);
    },
    [applyCloseAction]
  );

  const handleIslandOpen = useCallback(() => {
    setIslandMode(TOP_BAR_COMPACT_MODE);
    void showCompactModeOnly(TOP_BAR_COMPACT_MODE);
  }, [setIslandMode]);

  const handleMinimize = useCallback(() => {
    setIslandMode(TOP_BAR_COMPACT_MODE);
    void showCompactModeOnly(TOP_BAR_COMPACT_MODE);
  }, [setIslandMode]);

  const handleDiscussionOpen = useCallback(() => {
    openDiscussionWizard();
  }, [openDiscussionWizard]);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const isFull = await win.isFullscreen();
      await win.setFullscreen(!isFull);
    } catch {
      // Non-Tauri dev environment.
    }
  }, []);

  const handleDiscussionReviewOpen = useCallback(() => {
    setDiscussionReviewSnapshot(loadDiscussionReviewSnapshot(localStorage));
    setDiscussionReviewVisible(true);
  }, []);

  const agentMap = new Map<string, AgentInstanceInfo>();
  instances.forEach((info, id) => agentMap.set(id, info));

  const statusMap = new Map<string, AgentStatus>();
  statuses.forEach((status, id) => statusMap.set(id, status));

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden canvas-gradient">
      <TopBar
        onIslandOpen={handleIslandOpen}
        onMinimize={handleMinimize}
        onQuickReplyOpen={() => setSendToOpen(true)}
        onDiscussionOpen={handleDiscussionOpen}
        onAddAgent={() => setAddAgentOpen(true)}
        onSearch={() => setSearchOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onToggleFullscreen={handleToggleFullscreen}
        onClose={handleClose}
      />

      <div className="flex-1 min-h-0 relative">
        <Canvas
          agents={agentMap}
          agentStatuses={statusMap}
          isFullscreen={isFullscreen}
        />
        <Suspense fallback={null}>
          {expandedCardId && !isFullscreen && (
            <ExpandedAgentCard key={expandedCardId} instanceId={expandedCardId} />
          )}
        </Suspense>
      </div>

      <StatusBar onOpenSession={() => setSessionVisible(true)} />
      <Suspense fallback={null}>
        {addAgentOpen && (
          <AddAgentModal visible={addAgentOpen} onClose={() => setAddAgentOpen(false)} />
        )}
        {searchOpen && (
          <SearchPalette
            visible={searchOpen}
            onClose={() => setSearchOpen(false)}
            onAddAgent={() => setAddAgentOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onDiscussion={handleDiscussionOpen}
            onDiscussionReview={handleDiscussionReviewOpen}
          />
        )}
        {settingsOpen && (
          <SettingsPanel visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
        )}
        {sendToOpen && (
          <SendToPanel visible={sendToOpen} onClose={() => setSendToOpen(false)} />
        )}
        {discussionOpen && <DiscussionPanel />}
        {discussionReviewVisible && (
          <DiscussionReviewModal
            visible={discussionReviewVisible}
            snapshot={discussionReviewSnapshot}
            onClose={() => setDiscussionReviewVisible(false)}
          />
        )}
      </Suspense>

      {sessionVisible && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(26,26,26,0.82)", backdropFilter: "blur(6px)" }}
        >
          <div
            className="relative flex flex-col"
            style={{
              width: "92vw",
              height: "88vh",
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid #3A3A3A",
              boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
              background: "#1A1A1A",
            }}
          >
            <button
              onClick={() => setSessionVisible(false)}
              className="absolute top-4 right-4 z-10 flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#3A3A3A] text-[#B8B3B0] hover:text-[#F2F2F2] transition-colors"
              aria-label="Close session event timeline"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <Suspense fallback={null}>
              <SessionPlayback />
            </Suspense>
          </div>
        </div>
      )}

      <CloseConfirmModal
        visible={closeModalVisible}
        onConfirm={handleCloseConfirm}
        onCancel={() => setCloseModalVisible(false)}
      />
    </div>
  );
}
