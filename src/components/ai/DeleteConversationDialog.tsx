import React from 'react';
import { AiConversation } from '../../services/ai/chatHistoryTypes';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface DeleteConversationDialogProps {
  conversation: AiConversation | null;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const DeleteConversationDialog: React.FC<DeleteConversationDialogProps> = ({
  conversation,
  isDeleting,
  error,
  onConfirm,
  onCancel
}) => {
  return (
    <ConfirmDialog
      isOpen={Boolean(conversation)}
      title="Delete conversation permanently?"
      message={
        conversation
          ? `This permanently deletes "${conversation.title}" and all of its messages. This action cannot be undone.`
          : ''
      }
      confirmLabel="Delete permanently"
      cancelLabel="Cancel"
      tone="danger"
      isDestructive={true}
      isLoading={isDeleting}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
};
