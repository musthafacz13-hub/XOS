import React from 'react';
import { Note } from '../../types/notes';
import { NoteCard } from './NoteCard';

interface NotesListProps {
  notes: Note[];
  selectedNoteId: string | null;
  onSelectNote: (note: Note) => void;
}

export const NotesList: React.FC<NotesListProps> = React.memo(({
  notes,
  selectedNoteId,
  onSelectNote
}) => {
  return (
    <div className="space-y-2.5" role="list" aria-label="Saved notes">
      {notes.map((note) => (
        <div key={note.id} role="listitem">
          <NoteCard
            note={note}
            isSelected={note.id === selectedNoteId}
            onSelect={onSelectNote}
          />
        </div>
      ))}
    </div>
  );
});
