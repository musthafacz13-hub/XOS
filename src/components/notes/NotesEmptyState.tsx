import React from 'react';
import { StickyNote } from 'lucide-react';
import { EmptyState } from '../common/EmptyState';

interface NotesEmptyStateProps {
  onCreateNote: () => void;
}

export const NotesEmptyState: React.FC<NotesEmptyStateProps> = ({ onCreateNote }) => {
  return (
    <EmptyState
      icon={StickyNote}
      iconName="notes"
      title="No notes yet"
      description="Create personal notes, purchase plans, shopping lists, or reminders. Optional budgets stay independent from your financial ledgers."
      actionLabel="Create First Note"
      onAction={onCreateNote}
    />
  );
};
