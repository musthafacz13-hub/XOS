import React, { useEffect, useRef } from 'react';
import { Archive, ArchiveRestore, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { AiConversation } from '../../services/ai/chatHistoryTypes';

interface ChatActionMenuProps {
  conversation: AiConversation;
  isOpen: boolean;
  onClose: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  allowRename?: boolean;
}

export const ChatActionMenu: React.FC<ChatActionMenuProps> = ({
  conversation,
  isOpen,
  onClose,
  onRename,
  onTogglePin,
  onToggleArchive,
  onDelete,
  allowRename = true
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${conversation.title}`}
      data-testid={`chat-action-menu-${conversation.id}`}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className="absolute right-2 top-11 z-30 w-44 rounded-xl border border-black/[0.08] bg-white shadow-lg py-1.5 text-left"
    >
      {allowRename && !conversation.archived && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onRename();
          }}
          className="w-full px-3.5 py-2.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] flex items-center gap-2.5 cursor-pointer min-h-[40px]"
        >
          <Pencil className="w-3.5 h-3.5 text-[#6e6e73]" />
          <span>Rename</span>
        </button>
      )}

      {!conversation.archived && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onTogglePin();
          }}
          className="w-full px-3.5 py-2.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] flex items-center gap-2.5 cursor-pointer min-h-[40px]"
        >
          {conversation.pinned ? (
            <>
              <PinOff className="w-3.5 h-3.5 text-[#6e6e73]" />
              <span>Unpin</span>
            </>
          ) : (
            <>
              <Pin className="w-3.5 h-3.5 text-[#0284c7]" />
              <span>Pin</span>
            </>
          )}
        </button>
      )}

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onToggleArchive();
        }}
        className="w-full px-3.5 py-2.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] flex items-center gap-2.5 cursor-pointer min-h-[40px]"
      >
        {conversation.archived ? (
          <>
            <ArchiveRestore className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>Restore chat</span>
          </>
        ) : (
          <>
            <Archive className="w-3.5 h-3.5 text-[#6e6e73]" />
            <span>Archive</span>
          </>
        )}
      </button>

      <div className="my-1 border-t border-black/[0.06]" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onDelete();
        }}
        className="w-full px-3.5 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50/70 flex items-center gap-2.5 cursor-pointer min-h-[40px]"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Delete</span>
      </button>
    </div>
  );
};
