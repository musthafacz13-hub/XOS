import React, { useEffect } from 'react';
import { Archive, PanelLeftClose, X } from 'lucide-react';
import { AiConversation, ConversationGroup } from '../../services/ai/chatHistoryTypes';
import { ArchivedChatsView } from './ArchivedChatsView';
import { ChatHistoryList } from './ChatHistoryList';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { NewChatButton } from './NewChatButton';

interface ChatHistoryPanelProps {
  isDesktopOpen: boolean;
  isMobileOpen: boolean;
  showArchived: boolean;
  onSetShowArchived: (show: boolean) => void;
  onCloseDesktop: () => void;
  onCloseMobile: () => void;
  pinned: AiConversation[];
  recentGroups: ConversationGroup[];
  archived: AiConversation[];
  activeConversationId: string | null;
  busyConversationId: string | null;
  isLoading: boolean;
  error: string | null;
  isOffline?: boolean;
  isNewChatDisabled?: boolean;
  deleteTarget: AiConversation | null;
  isDeleting: boolean;
  deleteError: string | null;
  onRetryLoad: () => void;
  onNewChat: () => void;
  onSelectConversation: (conversation: AiConversation) => void;
  onRenameConversation: (conversationId: string, nextTitle: string) => Promise<void>;
  onTogglePinConversation: (conversation: AiConversation) => void;
  onToggleArchiveConversation: (conversation: AiConversation) => void;
  onRequestDeleteConversation: (conversation: AiConversation) => void;
  onConfirmDeleteConversation: () => Promise<void>;
  onCancelDeleteConversation: () => void;
}

export const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({
  isDesktopOpen,
  isMobileOpen,
  showArchived,
  onSetShowArchived,
  onCloseDesktop,
  onCloseMobile,
  pinned,
  recentGroups,
  archived,
  activeConversationId,
  busyConversationId,
  isLoading,
  error,
  isOffline = false,
  isNewChatDisabled = false,
  deleteTarget,
  isDeleting,
  deleteError,
  onRetryLoad,
  onNewChat,
  onSelectConversation,
  onRenameConversation,
  onTogglePinConversation,
  onToggleArchiveConversation,
  onRequestDeleteConversation,
  onConfirmDeleteConversation,
  onCancelDeleteConversation
}) => {
  useEffect(() => {
    if (!isMobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleteTarget) {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteTarget, isMobileOpen, onCloseMobile]);

  const panelBody = (isMobileDrawer: boolean) => (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-black/[0.06]">
        <h2 className="text-sm font-bold text-[#111111] tracking-tight">
          {showArchived ? 'Archived Chats' : 'Conversations'}
        </h2>

        <button
          type="button"
          onClick={isMobileDrawer ? onCloseMobile : onCloseDesktop}
          aria-label="Close chat history"
          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-[#111111] hover:bg-neutral-100 cursor-pointer"
        >
          {isMobileDrawer ? (
            <X className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {!showArchived && (
        <div className="py-3">
          <NewChatButton
            onClick={() => {
              onNewChat();
              if (isMobileDrawer) onCloseMobile();
            }}
            disabled={isNewChatDisabled}
          />
        </div>
      )}

      {showArchived ? (
        <ArchivedChatsView
          conversations={archived}
          busyConversationId={busyConversationId}
          onBack={() => onSetShowArchived(false)}
          onRestore={onToggleArchiveConversation}
          onRequestDelete={onRequestDeleteConversation}
        />
      ) : (
        <>
          <ChatHistoryList
            pinned={pinned}
            recentGroups={recentGroups}
            activeConversationId={activeConversationId}
            busyConversationId={busyConversationId}
            isLoading={isLoading}
            error={error}
            isOffline={isOffline}
            onRetry={onRetryLoad}
            onSelect={(conv) => {
              onSelectConversation(conv);
              if (isMobileDrawer) onCloseMobile();
            }}
            onRename={onRenameConversation}
            onTogglePin={onTogglePinConversation}
            onToggleArchive={onToggleArchiveConversation}
            onRequestDelete={onRequestDeleteConversation}
          />

          <div className="pt-2.5 mt-2 border-t border-black/[0.06]">
            <button
              type="button"
              onClick={() => onSetShowArchived(true)}
              data-testid="open-archived-chats-button"
              className="w-full px-3 py-2 rounded-xl text-xs font-medium text-neutral-600 hover:text-[#111111] hover:bg-neutral-50 flex items-center justify-between cursor-pointer min-h-[40px]"
            >
              <span className="inline-flex items-center gap-2">
                <Archive className="w-3.5 h-3.5 text-neutral-400" />
                <span>Archived Chats</span>
              </span>
              <span className="text-[11px] text-neutral-400 tabular-nums">
                {archived.length}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {isDesktopOpen && (
        <aside
          aria-label="Conversation history sidebar"
          data-testid="chat-history-desktop-panel"
          className="hidden lg:flex lg:flex-col w-72 shrink-0 border-r border-black/[0.06] pr-4 mr-2 min-h-[calc(100dvh-11rem)] max-h-[calc(100dvh-10rem)] sticky top-20"
        >
          {panelBody(false)}
        </aside>
      )}

      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Conversation history"
          data-testid="chat-history-mobile-drawer"
        >
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 w-[86%] max-w-xs h-full bg-white border-r border-black/[0.08] p-4 shadow-xl flex flex-col">
            {panelBody(true)}
          </div>
        </div>
      )}

      <DeleteConversationDialog
        conversation={deleteTarget}
        isDeleting={isDeleting}
        error={deleteError}
        onConfirm={onConfirmDeleteConversation}
        onCancel={onCancelDeleteConversation}
      />
    </>
  );
};
