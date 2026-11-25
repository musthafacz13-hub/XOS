import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { notesService } from '../../services/notesService';
import {
  NOTE_TYPE_OPTIONS,
  Note,
  NoteFormInput,
  NoteSortOrder,
  NoteTypeFilter,
  getNoteTypeLabel
} from '../../types/notes';
import {
  filterAndSortNotes,
  formatNoteBudget,
  formatNoteDetailedTimestamp
} from '../../utils/noteValidation';
import { formatHumanDate } from '../../utils/formatters';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  PageHeader,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SectionCard
} from '../ui';
import { NotesList } from './NotesList';
import { NoteEditor } from './NoteEditor';
import { DeleteNoteDialog } from './DeleteNoteDialog';
import { NotesEmptyState } from './NotesEmptyState';

export const NotesView: React.FC = () => {
  const { user } = useAuth();

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [noteTypeFilter, setNoteTypeFilter] = useState<NoteTypeFilter>('all');
  const [sortOrder, setSortOrder] = useState<NoteSortOrder>('updated_desc');

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [mobileReaderOpen, setMobileReaderOpen] = useState<boolean>(false);

  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [feedbackNotice, setFeedbackNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const mountedRef = useRef(true);
  const fetchSeqRef = useRef(0);
  const isDeletingRef = useRef(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const showFeedback = useCallback((type: 'success' | 'error', text: string) => {
    if (!mountedRef.current) return;
    setFeedbackNotice({ type, text });
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setFeedbackNotice(null);
      }
    }, 4500);
  }, []);

  const loadNotes = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    const controller = new AbortController();

    setLoading(true);
    setFetchError(null);

    try {
      const records = await notesService.listNotes(controller.signal);
      if (!mountedRef.current || seq !== fetchSeqRef.current) return;
      setNotes(records);
    } catch (err) {
      if (!mountedRef.current || seq !== fetchSeqRef.current) return;
      if (import.meta.env?.DEV) {
        console.error('Failed to load notes:', err);
      }
      setFetchError(sanitizeDatabaseErrorMessage(err, 'Could not load your notes. Please check your connection and try again.'));
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setNotes([]);
      setSelectedNoteId(null);
      setLoading(false);
      return;
    }
    loadNotes();
  }, [user?.id, loadNotes]);

  const filteredNotes = useMemo(
    () =>
      filterAndSortNotes(notes, {
        searchQuery,
        noteTypeFilter,
        sortOrder
      }),
    [notes, searchQuery, noteTypeFilter, sortOrder]
  );

  // Keep desktop selection aligned with visible notes
  const selectedNote = useMemo(() => {
    if (filteredNotes.length === 0) return null;
    return filteredNotes.find(n => n.id === selectedNoteId) || filteredNotes[0];
  }, [filteredNotes, selectedNoteId]);

  const handleSelectNote = useCallback((note: Note) => {
    setSelectedNoteId(note.id);
    setMobileReaderOpen(true);
  }, []);

  const openCreateModal = useCallback(() => {
    setEditingNote(null);
    setIsEditorOpen(true);
  }, []);

  const openEditModal = useCallback((note: Note) => {
    setEditingNote(note);
    setIsEditorOpen(true);
  }, []);

  const handleSaveNote = useCallback(
    async (input: NoteFormInput, existing: Note | null) => {
      if (existing) {
        const updated = await notesService.updateNote(existing.id, input, existing.updatedAt);
        if (!mountedRef.current) return;
        setNotes(prev => prev.map(n => (n.id === updated.id ? updated : n)));
        setSelectedNoteId(updated.id);
        showFeedback('success', 'Note updated.');
      } else {
        const created = await notesService.createNote(input);
        if (!mountedRef.current) return;
        setNotes(prev => [created, ...prev]);
        setSelectedNoteId(created.id);
        showFeedback('success', 'Note saved.');
      }
    },
    [showFeedback]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || isDeletingRef.current) return;

    isDeletingRef.current = true;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      await notesService.deleteNote(deleteTarget.id);
      if (!mountedRef.current) return;

      const deletedId = deleteTarget.id;
      setNotes(prev => prev.filter(n => n.id !== deletedId));
      if (selectedNoteId === deletedId) {
        setSelectedNoteId(null);
        setMobileReaderOpen(false);
      }
      setDeleteTarget(null);
      showFeedback('success', 'Note deleted.');
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('Failed to delete note:', err);
      }
      if (mountedRef.current) {
        setDeleteError(sanitizeDatabaseErrorMessage(err, 'Could not delete note. Please try again.'));
      }
    } finally {
      isDeletingRef.current = false;
      if (mountedRef.current) {
        setIsDeleting(false);
      }
    }
  }, [deleteTarget, selectedNoteId, showFeedback]);

  const hasActiveFilters = searchQuery.trim() !== '' || noteTypeFilter !== 'all';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notes"
        description="Capture purchase plans, shopping lists, reminders, and personal notes."
        actions={
          <button
            onClick={openCreateModal}
            type="button"
            className={PRIMARY_BUTTON_CLASS}
          >
            <Plus className="w-4 h-4" />
            <span>New Note</span>
          </button>
        }
      />

      {/* Transient Save / Update / Delete Feedback */}
      {feedbackNotice && (
        <div
          role={feedbackNotice.type === 'error' ? 'alert' : 'status'}
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedbackNotice.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackNotice.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span className="font-medium">{feedbackNotice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackNotice(null)}
            className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg hover:bg-black/[0.05] cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search, Filter & Sort Controls */}
      {notes.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#86868b] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes by title or content..."
                aria-label="Search notes by title or content"
                className="w-full min-h-[44px] sm:min-h-[40px] pl-10 pr-9 py-2 text-base md:text-sm text-[#1d1d1f] bg-[#f5f5f7] border border-transparent focus:bg-white focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 rounded-xl placeholder:text-[#86868b] transition-colors focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-[#86868b] hover:text-[#1d1d1f] cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort Selector */}
            <div className="shrink-0">
              <label htmlFor="notes-sort-order" className="sr-only">
                Sort notes
              </label>
              <select
                id="notes-sort-order"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as NoteSortOrder)}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] px-3.5 py-2 text-base md:text-sm font-medium text-[#1d1d1f] bg-white border border-black/[0.12] rounded-xl focus:outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 cursor-pointer"
              >
                <option value="updated_desc">Recently updated</option>
                <option value="updated_asc">Oldest first</option>
              </select>
            </div>
          </div>

          {/* Interactive Note Type Segmented Filter Track */}
          <div
            className="inline-flex items-center gap-1 bg-[#f5f5f7] p-1 rounded-xl max-w-full overflow-x-auto no-scrollbar"
            role="tablist"
            aria-label="Filter by note type"
          >
            <button
              type="button"
              role="tab"
              aria-selected={noteTypeFilter === 'all'}
              onClick={() => setNoteTypeFilter('all')}
              className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 text-xs rounded-lg whitespace-nowrap shrink-0 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] ${
                noteTypeFilter === 'all'
                  ? 'bg-white text-[#1d1d1f] font-semibold shadow-2xs ring-1 ring-black/[0.05]'
                  : 'text-[#6e6e73] font-medium hover:text-[#1d1d1f]'
              }`}
            >
              All
            </button>
            {NOTE_TYPE_OPTIONS.map((opt) => {
              const active = noteTypeFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setNoteTypeFilter(opt.value)}
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 text-xs rounded-lg whitespace-nowrap shrink-0 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] ${
                    active
                      ? 'bg-white text-[#1d1d1f] font-semibold shadow-2xs ring-1 ring-black/[0.05]'
                      : 'text-[#6e6e73] font-medium hover:text-[#1d1d1f]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-pulse" aria-busy="true">
          <div className="lg:col-span-5 space-y-2.5">
            <div className="h-28 bg-[#f5f5f7] rounded-2xl" />
            <div className="h-28 bg-[#f5f5f7] rounded-2xl" />
            <div className="h-28 bg-[#f5f5f7] rounded-2xl" />
          </div>
          <div className="hidden lg:block lg:col-span-7 h-80 bg-[#f5f5f7] rounded-2xl" />
        </div>
      ) : fetchError ? (
        <SectionCard padding="lg" className="border-rose-200 bg-rose-50/60 text-center">
          <div className="space-y-3">
            <AlertCircle className="w-6 h-6 text-rose-600 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#1d1d1f]">Unable to load notes</h3>
              <p className="text-xs text-[#6e6e73] max-w-md mx-auto">{fetchError}</p>
            </div>
            <button
              type="button"
              onClick={loadNotes}
              className={PRIMARY_BUTTON_CLASS}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </SectionCard>
      ) : notes.length === 0 ? (
        <NotesEmptyState onCreateNote={openCreateModal} />
      ) : filteredNotes.length === 0 ? (
        <SectionCard padding="lg" className="text-center">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#1d1d1f]">No matching notes</h3>
            <p className="text-xs text-[#6e6e73]">
              No notes matched your current search or note type filter.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setNoteTypeFilter('all');
                }}
                className={SECONDARY_BUTTON_CLASS}
              >
                Clear Filters
              </button>
            )}
          </div>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Notes List (hidden on mobile when reader view is open) */}
          <div className={`lg:col-span-5 ${mobileReaderOpen ? 'hidden lg:block' : 'block'}`}>
            <div className="flex items-center justify-between mb-2.5 text-xs text-[#6e6e73]">
              <span className="tabular-nums">
                Showing {filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}
              </span>
            </div>
            <NotesList
              notes={filteredNotes}
              selectedNoteId={selectedNote?.id || null}
              onSelectNote={handleSelectNote}
            />
          </div>

          {/* Right Column / Mobile Reader: Complete Note Content */}
          {selectedNote && (
            <SectionCard
              padding="lg"
              className={`lg:col-span-7 ${
                mobileReaderOpen ? 'block' : 'hidden lg:block'
              }`}
            >
              {/* Mobile Back Button */}
              <div className="lg:hidden mb-4 pb-3 border-b border-black/[0.06]">
                <button
                  type="button"
                  onClick={() => setMobileReaderOpen(false)}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-2 -ml-2 text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer rounded-lg"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>All Notes</span>
                </button>
              </div>

              {/* Note Header & Actions */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6e6e73]">
                    <span className="font-medium text-[#1d1d1f]">
                      {getNoteTypeLabel(selectedNote.noteType)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      Updated {formatNoteDetailedTimestamp(selectedNote.updatedAt)}
                    </span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-semibold text-[#1d1d1f] tracking-[-0.015em] break-words">
                    {selectedNote.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(selectedNote)}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(selectedNote);
                    }}
                    className="min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              {/* Clean Hairline Planning Metadata Strip */}
              <div className="mt-4 py-3 border-y border-black/[0.06] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="block text-[#6e6e73]">Estimated budget</span>
                  <span
                    className={`mt-0.5 block font-semibold tabular-nums ${
                      selectedNote.estimatedAmount !== null ? 'text-[#1d1d1f]' : 'text-[#6e6e73] font-medium'
                    }`}
                  >
                    {formatNoteBudget(selectedNote.estimatedAmount)}
                  </span>
                </div>

                <div>
                  <span className="block text-[#6e6e73]">Target date</span>
                  <span className="mt-0.5 block font-medium text-[#1d1d1f] tabular-nums">
                    {selectedNote.targetDate ? formatHumanDate(selectedNote.targetDate) : 'Optional / Not set'}
                  </span>
                </div>

                <div>
                  <span className="block text-[#6e6e73]">Created</span>
                  <span className="mt-0.5 block font-medium text-[#1d1d1f] tabular-nums">
                    {formatNoteDetailedTimestamp(selectedNote.createdAt)}
                  </span>
                </div>
              </div>

              {/* Full Note Content */}
              <div className="mt-5">
                <h4 className="text-xs font-medium text-[#6e6e73] mb-2">Content</h4>
                <div className="text-sm text-[#1d1d1f] leading-relaxed whitespace-pre-wrap break-words">
                  {selectedNote.content}
                </div>
              </div>

              {/* Optional Additional Details */}
              {selectedNote.additionalDetails && (
                <div className="mt-5 pt-4 border-t border-black/[0.06]">
                  <h4 className="text-xs font-medium text-[#6e6e73] mb-1.5">Additional details</h4>
                  <div className="text-xs sm:text-sm text-[#6e6e73] leading-relaxed whitespace-pre-wrap break-words">
                    {selectedNote.additionalDetails}
                  </div>
                </div>
              )}
            </SectionCard>
          )}
        </div>
      )}

      {/* Create / Edit Note Modal */}
      <NoteEditor
        isOpen={isEditorOpen}
        editingNote={editingNote}
        onSave={handleSaveNote}
        onClose={() => setIsEditorOpen(false)}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteNoteDialog
        isOpen={Boolean(deleteTarget)}
        noteTitle={deleteTarget?.title || 'this note'}
        isDeleting={isDeleting}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!isDeleting) {
            setDeleteError(null);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
};
