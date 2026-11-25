import React from 'react';
import { getNoteTypeLabel, Note } from '../../types/notes';
import { formatHumanDate } from '../../utils/formatters';
import { formatNoteBudget, formatNoteTimestamp } from '../../utils/noteValidation';

interface NoteCardProps {
  note: Note;
  isSelected: boolean;
  onSelect: (note: Note) => void;
}

export const NoteCard: React.FC<NoteCardProps> = React.memo(({
  note,
  isSelected,
  onSelect
}) => {
  const budgetText = formatNoteBudget(note.estimatedAmount);
  const updatedText = formatNoteTimestamp(note.updatedAt);

  return (
    <button
      type="button"
      onClick={() => onSelect(note)}
      aria-pressed={isSelected}
      className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] ${
        isSelected
          ? 'bg-neutral-50 border-[#111111]'
          : 'bg-white border-black/[0.08] hover:border-black/[0.18] hover:bg-neutral-50/50'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#111111] tracking-tight truncate">
          {note.title}
        </h3>
        <span className="text-xs font-medium text-neutral-500 whitespace-nowrap shrink-0 tabular-nums">
          {updatedText}
        </span>
      </div>

      <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed line-clamp-2 whitespace-pre-line">
        {note.content}
      </p>

      <div className="mt-3 pt-2.5 border-t border-black/[0.05] flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
        <span className="font-medium text-neutral-700">{getNoteTypeLabel(note.noteType)}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">
          Budget: <span className={note.estimatedAmount !== null ? 'font-semibold text-[#111111]' : 'text-neutral-500'}>{budgetText}</span>
        </span>
        {note.targetDate && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Target: {formatHumanDate(note.targetDate)}</span>
          </>
        )}
      </div>
    </button>
  );
});
