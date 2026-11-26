import React from 'react';
import { SquarePen } from 'lucide-react';

interface NewChatButtonProps {
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}

export const NewChatButton: React.FC<NewChatButtonProps> = ({
  onClick,
  disabled = false,
  compact = false
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Start new chat"
      data-testid="new-chat-button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] disabled:opacity-50 disabled:cursor-not-allowed ${
        compact
          ? 'px-3 py-2 sm:py-1.5 text-xs bg-[#e8f2ff] text-[#0071e3] hover:bg-[#dcebff] min-h-[44px] sm:min-h-[38px]'
          : 'w-full px-3.5 py-2.5 text-xs bg-[#0071e3] hover:bg-[#0077ed] text-white min-h-[44px]'
      }`}
    >
      <SquarePen className="w-3.5 h-3.5 shrink-0" />
      <span>New Chat</span>
    </button>
  );
};
