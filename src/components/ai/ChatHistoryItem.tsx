import React, { useEffect, useRef, useState } from 'react';
import { Check, MoreHorizontal, Pin, X } from 'lucide-react';
import { AiConversation } from '../../services/ai/chatHistoryTypes';
import { formatConversationTimestamp } from '../../services/ai/chatHistoryUtils';
import { LongPressController } from '../../services/ai/longPressGesture';
import { ChatActionMenu } from './ChatActionMenu';

interface ChatHistoryItemProps {
  conversation: AiConversation;
  isActive: boolean;
  isBusy?: boolean;
  onSelect: (conversation: AiConversation) => void;
  onRename: (conversationId: string, nextTitle: string) => Promise<void>;
  onTogglePin: (conversation: AiConversation) => void;
  onToggleArchive: (conversation: AiConversation) => void;
  onRequestDelete: (conversation: AiConversation) => void;
}

export const ChatHistoryItem: React.FC<ChatHistoryItemProps> = ({
  conversation,
  isActive,
  isBusy = false,
  onSelect,
  onRename,
  onTogglePin,
  onToggleArchive,
  onRequestDelete
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(conversation.title);
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const longPressRef = useRef<LongPressController | null>(null);
  if (!longPressRef.current) {
    longPressRef.current = new LongPressController({
      onLongPress: () => {
        setMenuOpen(true);
      }
    });
  }

  useEffect(() => {
    setRenameDraft(conversation.title);
  }, [conversation.title]);

  useEffect(() => {
    if (isRenaming) {
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [isRenaming]);

  useEffect(() => {
    return () => {
      longPressRef.current?.cancel();
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isRenaming || menuOpen || e.touches.length !== 1) return;
    const touch = e.touches[0];
    longPressRef.current?.start(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) {
      longPressRef.current?.cancel();
      return;
    }
    const touch = e.touches[0];
    longPressRef.current?.move(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = () => {
    longPressRef.current?.end();
  };

  const handleTouchCancel = () => {
    longPressRef.current?.cancel();
  };

  const handleRowClick = () => {
    if (longPressRef.current?.consumeTriggeredClick()) {
      return;
    }
    if (isRenaming || menuOpen) return;
    onSelect(conversation);
  };

  const handleCommitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = renameDraft.trim();
    if (!cleaned || cleaned === conversation.title) {
      setIsRenaming(false);
      setRenameDraft(conversation.title);
      return;
    }
    setRenameSubmitting(true);
    try {
      await onRename(conversation.id, cleaned);
      setIsRenaming(false);
    } finally {
      setRenameSubmitting(false);
    }
  };

  const formattedTime = formatConversationTimestamp(
    conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt
  );

  return (
    <div
      data-testid={`chat-history-item-${conversation.id}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onContextMenu={(e) => {
        if (longPressRef.current?.isLongPressActive() || menuOpen) {
          e.preventDefault();
        }
      }}
      className={`group relative rounded-xl transition-colors select-none touch-pan-y [-webkit-touch-callout:none] ${
        isActive
          ? 'bg-[#0284c7]/[0.08]'
          : 'hover:bg-[#f5f5f7]'
      }`}
    >
      {isRenaming ? (
        <form
          onSubmit={(e) => void handleCommitRename(e)}
          className="flex items-center gap-1.5 px-2.5 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={renameInputRef}
            type="text"
            value={renameDraft}
            maxLength={120}
            disabled={renameSubmitting}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsRenaming(false);
                setRenameDraft(conversation.title);
              }
            }}
            aria-label="Conversation title"
            className="flex-1 min-w-0 rounded-lg border border-[#0284c7] bg-white px-2.5 py-1.5 text-base sm:text-xs text-[#1d1d1f] focus:outline-none"
          />
          <button
            type="submit"
            disabled={renameSubmitting || !renameDraft.trim()}
            aria-label="Save conversation title"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-[#0284c7] text-white hover:bg-[#0369a1] cursor-pointer disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={renameSubmitting}
            onClick={() => {
              setIsRenaming(false);
              setRenameDraft(conversation.title);
            }}
            aria-label="Cancel rename"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#6e6e73] hover:bg-[#f5f5f7] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-1 pr-1.5">
          <button
            type="button"
            onClick={handleRowClick}
            disabled={isBusy}
            className="flex-1 min-w-0 text-left px-3 py-2.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] rounded-xl min-h-[54px] disabled:opacity-60"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-[13px] font-semibold truncate ${
                  isActive ? 'text-[#0284c7]' : 'text-[#1d1d1f]'
                }`}
              >
                {conversation.title}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-[#86868b] tabular-nums shrink-0">
                {conversation.pinned && (
                  <Pin className="w-3 h-3 text-[#0284c7]" aria-label="Pinned" />
                )}
                <span>{formattedTime}</span>
              </span>
            </div>

            {conversation.lastMessagePreview ? (
              <p className="mt-0.5 text-xs text-[#6e6e73] truncate">
                {conversation.lastMessagePreview}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-[#86868b] truncate">
                No messages yet
              </p>
            )}
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(prev => !prev);
            }}
            aria-label={`More actions for ${conversation.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-opacity cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] ${
              menuOpen ? 'opacity-100 bg-[#f5f5f7] text-[#1d1d1f]' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'
            }`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      )}

      <ChatActionMenu
        conversation={conversation}
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        onRename={() => setIsRenaming(true)}
        onTogglePin={() => onTogglePin(conversation)}
        onToggleArchive={() => onToggleArchive(conversation)}
        onDelete={() => onRequestDelete(conversation)}
      />
    </div>
  );
};
