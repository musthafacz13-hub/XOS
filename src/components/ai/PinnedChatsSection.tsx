import React from 'react';
import { AiConversation } from '../../services/ai/chatHistoryTypes';
import { ChatHistoryItem } from './ChatHistoryItem';

interface PinnedChatsSectionProps {
  conversations: AiConversation[];
  activeConversationId: string | null;
  busyConversationId: string | null;
  onSelect: (conversation: AiConversation) => void;
  onRename: (conversationId: string, nextTitle: string) => Promise<void>;
  onTogglePin: (conversation: AiConversation) => void;
  onToggleArchive: (conversation: AiConversation) => void;
  onRequestDelete: (conversation: AiConversation) => void;
}

export const PinnedChatsSection: React.FC<PinnedChatsSectionProps> = ({
  conversations,
  activeConversationId,
  busyConversationId,
  onSelect,
  onRename,
  onTogglePin,
  onToggleArchive,
  onRequestDelete
}) => {
  if (conversations.length === 0) return null;

  return (
    <section aria-label="Pinned conversations" className="pb-3 mb-3 border-b border-black/[0.06]">
      <h3 className="px-3 pb-1.5 text-[11px] font-semibold text-[#86868b] tracking-wide">
        Pinned
      </h3>
      <div className="space-y-0.5">
        {conversations.map(conv => (
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
  );
};
