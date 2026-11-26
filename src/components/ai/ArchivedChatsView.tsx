import React from 'react';
import { ArchiveRestore, ArrowLeft, Trash2 } from 'lucide-react';
import { AiConversation } from '../../services/ai/chatHistoryTypes';
import { formatConversationTimestamp } from '../../services/ai/chatHistoryUtils';

interface ArchivedChatsViewProps {
  conversations: AiConversation[];
  busyConversationId: string | null;
  onBack: () => void;
  onRestore: (conversation: AiConversation) => void;
  onRequestDelete: (conversation: AiConversation) => void;
}

export const ArchivedChatsView: React.FC<ArchivedChatsViewProps> = ({
  conversations,
  busyConversationId,
  onBack,
  onRestore,
  onRequestDelete
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="archived-chats-view">
      <div className="flex items-center justify-between gap-2 pb-2.5 mb-2 border-b border-black/[0.06]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer min-h-[36px]"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Chats</span>
        </button>
        <span className="text-[11px] text-[#86868b] tabular-nums">
          {conversations.length} archived
        </span>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain space-y-1.5 py-1">
        {conversations.length === 0 ? (
          <div className="px-4 py-10 text-center space-y-1.5">
            <p className="text-xs font-medium text-[#6e6e73]">No archived conversations</p>
            <p className="text-[11px] text-[#86868b] leading-relaxed">
              Archived chats retain all messages here until you restore or permanently delete them.
            </p>
          </div>
        ) : (
          conversations.map(conv => {
            const isBusy = busyConversationId === conv.id;
            const timeLabel = formatConversationTimestamp(
              conv.lastMessageAt || conv.updatedAt || conv.createdAt
            );

            return (
              <div
                key={conv.id}
                data-testid={`archived-chat-item-${conv.id}`}
                className="rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#1d1d1f] truncate">
                      {conv.title}
                    </p>
                    <p className="text-xs text-[#6e6e73] truncate mt-0.5">
                      {conv.lastMessagePreview || 'Saved conversation'}
                    </p>
                  </div>
                  <span className="text-[11px] text-[#86868b] tabular-nums shrink-0">
                    {timeLabel}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onRestore(conv)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#e8f2ff] text-[#0071e3] hover:bg-[#dcebff] text-xs font-semibold cursor-pointer disabled:opacity-50 min-h-[36px]"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                    <span>Restore</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onRequestDelete(conv)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[#c92a2a] hover:bg-[#fef2f2] text-xs font-medium cursor-pointer disabled:opacity-50 min-h-[36px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
