import React from 'react';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface DeleteNoteDialogProps {
  isOpen: boolean;
  noteTitle: string;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const DeleteNoteDialog: React.FC<DeleteNoteDialogProps> = ({
  isOpen,
  noteTitle,
  isDeleting,
  error,
  onConfirm,
  onCancel
}) => {
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title="Delete Note?"
      message={`Are you sure you want to permanently delete "${noteTitle}"? This action cannot be undone.`}
      confirmLabel="Delete Note"
      cancelLabel="Cancel"
      tone="danger"
      isLoading={isDeleting}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
};
