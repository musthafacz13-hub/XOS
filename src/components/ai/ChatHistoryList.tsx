import React from 'react';
import { MessageSquare, WifiOff } from 'lucide-react';
import { AiConversation, ConversationGroup } from '../../services/ai/chatHistoryTypes';
import { ChatHistoryItem } from './ChatHistoryItem';
import { PinnedChatsSection } from './PinnedChatsSection';

interface ChatHistoryListProps {
  pinned: AiConversation[];
  recentGroups: ConversationGroup[];
  activeConversationId: string | null;
  busyConversationId: string | null;
  isLoading: boolean;
  error: string | null;
  isOffline?: boolean;
  onRetry: () => void;
  onSelect: (conversation: AiConversation) => void;
  onRename: (conversationId: string, nextTitle: string) => Promise<void>;
  onTogglePin: (conversation: AiConversation) => void;
  onToggleArchive: (conversation: AiConversation) => void;
  onRequestDelete: (conversation: AiConversation) => void;
}

export const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  pinned,
  recentGroups,
  activeConversationId,
  busyConversationId,
  isLoading,
  error,
  isOffline = false,
  onRetry,
  onSelect,
  onRename,
  onTogglePin,
  onToggleArchive,
  onRequestDelete
}) => {
  const hasAny = pinned.length > 0 || recentGroups.length > 0;

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain py-1">
      {isOffline && (
        <div className="mx-2 mb-2 px-3 py-2 rounded-xl bg-neutral-100 text-xs text-neutral-600 flex items-center gap-2">
          <WifiOff className="w-3.5 h-3.5 shrink-0 text-neutral-500" />
          <span>Offline — cached session chats shown.</span>
        </div>
      )}

      {isLoading && !hasAny ? (
        <div className="space-y-2 px-2 py-2" aria-busy="true" aria-label="Loading conversations">
          {[1, 2, 3, 4].map(item => (
            <div key={item} className="rounded-xl px-3 py-2.5 space-y-1.5 animate-pulse">
              <div className="h-3.5 w-3/4 bg-neutral-100 rounded" />
              <div className="h-3 w-1/2 bg-neutral-100 rounded" />
            </div>
          ))}
        </div>
      ) : error && !hasAny ? (
        <div className="px-3 py-6 text-center space-y-2.5">
          <p className="text-xs text-rose-700 leading-relaxed">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:bg-sky-50 cursor-pointer min-h-[36px]"
          >
            Retry
          </button>
        </div>
      ) : !hasAny ? (
        <div className="px-4 py-10 text-center space-y-2">
          <MessageSquare className="w-5 h-5 text-neutral-300 mx-auto" />
          <p className="text-xs font-medium text-neutral-600">No conversations yet</p>
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            Ask Jarvis about your finances or speak a transaction to start your first saved chat.
          </p>
        </div>
      ) : (
        <>
          {error && (
            <div className="mx-2 mb-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200/80 flex items-center justify-between gap-2">
              <span className="text-[11px] text-rose-800 leading-snug">{error}</span>
              <button
                type="button"
                onClick={onRetry}
                className="text-[11px] font-semibold text-[#0284C7] shrink-0 cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          <PinnedChatsSection
            conversations={pinned}
            activeConversationId={activeConversationId}
            busyConversationId={busyConversationId}
            onSelect={onSelect}
            onRename={onRename}
            onTogglePin={onTogglePin}
            onToggleArchive={onToggleArchive}
            onRequestDelete={onRequestDelete}
          />

          <div className="space-y-4">
            {recentGroups.map(group => (
              <section key={group.label} aria-label={group.label}>
                <h3 className="px-3 pb-1 text-[11px] font-semibold text-neutral-400 tracking-wide">
                  {group.label}
                </h3>
                <div className="space-y-0.5">
                  {group.items.map(conv => (
                    <ChatHistoryItem
                      key={conv.id}
                      conversation={conv}
                      isActive={conv.id === activeConversationId}
                      isBusy={busyConversationId === conv.id}
                      onSelect={onSelect}
                      onRename={onRename}
                      onTogglePin={onTogglePin}
                      onToggleArchive={onToggleArchive}
                      onRequestDelete={onRequestDelete}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
