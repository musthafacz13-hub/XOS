import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { NOTE_TYPE_OPTIONS, Note, NoteFormInput, NoteType } from '../../types/notes';
import { validateNoteInput } from '../../utils/noteValidation';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  LABEL_CLASS,
  Modal,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS
} from '../ui';

interface NoteEditorProps {
  isOpen: boolean;
  editingNote: Note | null;
  onSave: (input: NoteFormInput, existingNote: Note | null) => Promise<void>;
  onClose: () => void;
}

const NOTE_INPUT_CLASS =
  'w-full min-h-[44px] px-3.5 py-2 text-base md:text-sm text-[#1d1d1f] bg-white border border-black/[0.12] rounded-xl placeholder:text-[#86868b] transition-colors focus:outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/15 disabled:bg-[#f5f5f7] disabled:text-[#86868b]';

export const NoteEditor: React.FC<NoteEditorProps> = ({
  isOpen,
  editingNote,
  onSave,
  onClose
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [noteType, setNoteType] = useState<NoteType>('general');
  const [estimatedAmountInput, setEstimatedAmountInput] = useState('');
  const [targetDateInput, setTargetDateInput] = useState('');
  const [additionalDetailsInput, setAdditionalDetailsInput] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSubmittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Hydrate fields whenever modal opens or target note changes
  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    setIsSubmitting(false);
    isSubmittingRef.current = false;

    if (editingNote) {
      setTitle(editingNote.title);
      setContent(editingNote.content);
      setNoteType(editingNote.noteType);
      setEstimatedAmountInput(
        editingNote.estimatedAmount !== null && editingNote.estimatedAmount !== undefined
          ? String(editingNote.estimatedAmount)
          : ''
      );
      setTargetDateInput(editingNote.targetDate || '');
      setAdditionalDetailsInput(editingNote.additionalDetails || '');
    } else {
      setTitle('');
      setContent('');
      setNoteType('general');
      setEstimatedAmountInput('');
      setTargetDateInput('');
      setAdditionalDetailsInput('');
    }
  }, [isOpen, editingNote]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;

    const payload: NoteFormInput = {
      title,
      content,
      noteType,
      estimatedAmountInput,
      targetDateInput,
      additionalDetailsInput
    };

    const validation = validateNoteInput(payload);
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    isSubmittingRef.current = true;
    setFormError(null);
    setIsSubmitting(true);

    try {
      await onSave(payload, editingNote);
      if (mountedRef.current) {
        onClose();
      }
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('Failed to save note:', err);
      }
      if (mountedRef.current) {
        setFormError(sanitizeDatabaseErrorMessage(err, 'Could not save note. Please try again.'));
      }
    } finally {
      isSubmittingRef.current = false;
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingNote ? 'Edit Note' : 'New Note'}
      subtitle="Notes stay separate from your expense, income, and savings ledgers."
      maxWidth="xl"
      disableClose={isSubmitting}
      labelledById="note-editor-title"
      footer={
        <>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="note-editor-form"
            disabled={isSubmitting}
            className={PRIMARY_BUTTON_CLASS}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>{editingNote ? 'Save Changes' : 'Save Note'}</span>
            )}
          </button>
        </>
      }
    >
      <form id="note-editor-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError && (
          <div
            role="alert"
            className="p-3 bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs rounded-xl flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-[#c92a2a] shrink-0 mt-0.5" />
            <span className="leading-relaxed">{formError}</span>
          </div>
        )}

        {/* Title (Required) */}
        <div>
          <label htmlFor="note-title" className={LABEL_CLASS}>
            Title <span className="text-[#c92a2a]">*</span>
          </label>
          <input
            id="note-title"
            type="text"
            required
            maxLength={200}
            disabled={isSubmitting}
            placeholder="e.g. Things to Buy Next Month"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (formError) setFormError(null);
            }}
            className={NOTE_INPUT_CLASS}
          />
        </div>

        {/* Content (Required) */}
        <div>
          <label htmlFor="note-content" className={LABEL_CLASS}>
            Content <span className="text-[#c92a2a]">*</span>
          </label>
          <textarea
            id="note-content"
            required
            rows={5}
            maxLength={20000}
            disabled={isSubmitting}
            placeholder={'• Laptop\n• Clothes\n• Personal accessories'}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (formError) setFormError(null);
            }}
            className="w-full px-3.5 py-2.5 text-base md:text-sm text-[#1d1d1f] bg-white border border-black/[0.12] rounded-xl placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/15 transition-colors resize-y min-h-[120px] disabled:bg-[#f5f5f7] disabled:text-[#86868b]"
          />
        </div>

        {/* Optional Fields Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Note Type (Optional, defaults to General) */}
          <div>
            <label htmlFor="note-type" className={LABEL_CLASS}>
              Note type <span className="text-[#86868b] font-normal">(optional)</span>
            </label>
            <select
              id="note-type"
              disabled={isSubmitting}
              value={noteType}
              onChange={(e) => setNoteType(e.target.value as NoteType)}
              className={`${NOTE_INPUT_CLASS} cursor-pointer`}
            >
              {NOTE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Estimated Budget (Optional INR) */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label htmlFor="note-budget" className="block text-xs font-medium text-[#6e6e73]">
                Estimated budget (₹) <span className="text-[#86868b] font-normal">(optional)</span>
              </label>
              {estimatedAmountInput.trim() !== '' && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setEstimatedAmountInput('');
                    if (formError) setFormError(null);
                  }}
                  className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-[#6e6e73] pointer-events-none select-none">
                ₹
              </span>
              <input
                id="note-budget"
                type="text"
                inputMode="decimal"
                disabled={isSubmitting}
                placeholder="Not decided"
                value={estimatedAmountInput}
                onChange={(e) => {
                  setEstimatedAmountInput(e.target.value);
                  if (formError) setFormError(null);
                }}
                className={`${NOTE_INPUT_CLASS} pl-8 tabular-nums`}
              />
            </div>
          </div>
        </div>

        {/* Target Date (Optional) */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label htmlFor="note-target-date" className="block text-xs font-medium text-[#6e6e73]">
              Target date <span className="text-[#86868b] font-normal">(optional)</span>
            </label>
            {targetDateInput.trim() !== '' && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setTargetDateInput('');
                  if (formError) setFormError(null);
                }}
                className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <input
            id="note-target-date"
            type="date"
            disabled={isSubmitting}
            value={targetDateInput}
            onChange={(e) => {
              setTargetDateInput(e.target.value);
              if (formError) setFormError(null);
            }}
            className={`${NOTE_INPUT_CLASS} tabular-nums`}
          />
        </div>

        {/* Additional Details (Optional) */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label htmlFor="note-details" className="block text-xs font-medium text-[#6e6e73]">
              Additional details <span className="text-[#86868b] font-normal">(optional)</span>
            </label>
            {additionalDetailsInput.trim() !== '' && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setAdditionalDetailsInput('')}
                className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            id="note-details"
            rows={2}
            maxLength={5000}
            disabled={isSubmitting}
            placeholder="Optional links, store notes, or extra context..."
            value={additionalDetailsInput}
            onChange={(e) => {
              setAdditionalDetailsInput(e.target.value);
              if (formError) setFormError(null);
            }}
            className="w-full px-3.5 py-2 text-base md:text-sm text-[#1d1d1f] bg-white border border-black/[0.12] rounded-xl placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/15 transition-colors resize-y disabled:bg-[#f5f5f7] disabled:text-[#86868b]"
          />
        </div>
      </form>
    </Modal>
  );
};
