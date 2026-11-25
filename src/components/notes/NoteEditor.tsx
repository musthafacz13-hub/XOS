import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { NOTE_TYPE_OPTIONS, Note, NoteFormInput, NoteType } from '../../types/notes';
import { validateNoteInput } from '../../utils/noteValidation';
import { modalBackdropVariants, modalContentVariants } from '../../utils/motion';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';

interface NoteEditorProps {
  isOpen: boolean;
  editingNote: Note | null;
  onSave: (input: NoteFormInput, existingNote: Note | null) => Promise<void>;
  onClose: () => void;
}

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

  // Escape key dismissal when not submitting
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => {
            if (!isSubmitting) onClose();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-editor-title"
        >
          <motion.div
            variants={modalContentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-black/[0.08] max-h-[92dvh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-black/[0.06] flex items-center justify-between gap-3 shrink-0">
              <div>
                <h2 id="note-editor-title" className="text-base font-bold text-[#111111] tracking-tight">
                  {editingNote ? 'Edit Note' : 'New Note'}
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Notes stay separate from your expense, income, and savings ledgers.
                </p>
              </div>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onClose}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer disabled:opacity-50"
                aria-label="Close note editor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1" noValidate>
              {formError && (
                <div
                  role="alert"
                  className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{formError}</span>
                </div>
              )}

              {/* Title (Required) */}
              <div className="space-y-1.5">
                <label htmlFor="note-title" className="block text-xs font-semibold text-neutral-800">
                  Title <span className="text-rose-600">*</span>
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
                  className="w-full min-h-[44px] px-3.5 py-2 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] focus-visible:border-[#111111] transition-colors disabled:opacity-60"
                />
              </div>

              {/* Content (Required) */}
              <div className="space-y-1.5">
                <label htmlFor="note-content" className="block text-xs font-semibold text-neutral-800">
                  Content <span className="text-rose-600">*</span>
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
                  className="w-full px-3.5 py-2.5 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] focus-visible:border-[#111111] transition-colors resize-y min-h-[120px] disabled:opacity-60"
                />
              </div>

              {/* Optional Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Note Type (Optional, defaults to General) */}
                <div className="space-y-1.5">
                  <label htmlFor="note-type" className="block text-xs font-semibold text-neutral-700">
                    Note type <span className="text-neutral-400 font-normal">(optional)</span>
                  </label>
                  <select
                    id="note-type"
                    disabled={isSubmitting}
                    value={noteType}
                    onChange={(e) => setNoteType(e.target.value as NoteType)}
                    className="w-full min-h-[44px] px-3 py-2 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] focus-visible:border-[#111111] transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {NOTE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Estimated Budget (Optional INR) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="note-budget" className="block text-xs font-semibold text-neutral-700">
                      Estimated budget (₹) <span className="text-neutral-400 font-normal">(optional)</span>
                    </label>
                    {estimatedAmountInput.trim() !== '' && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          setEstimatedAmountInput('');
                          if (formError) setFormError(null);
                        }}
                        className="text-[11px] font-medium text-neutral-500 hover:text-[#111111] underline cursor-pointer disabled:opacity-50"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-neutral-500 pointer-events-none select-none">
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
                      className="w-full min-h-[44px] pl-8 pr-3.5 py-2 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] focus-visible:border-[#111111] transition-colors tabular-nums disabled:opacity-60"
                    />
                  </div>
                </div>
              </div>

              {/* Target Date (Optional) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="note-target-date" className="block text-xs font-semibold text-neutral-700">
                    Target date <span className="text-neutral-400 font-normal">(optional)</span>
                  </label>
                  {targetDateInput.trim() !== '' && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setTargetDateInput('');
                        if (formError) setFormError(null);
                      }}
                      className="text-[11px] font-medium text-neutral-500 hover:text-[#111111] underline cursor-pointer disabled:opacity-50"
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
                  className="w-full min-h-[44px] px-3.5 py-2 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] focus-visible:border-[#111111] transition-colors tabular-nums disabled:opacity-60"
                />
              </div>

              {/* Additional Details (Optional) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="note-details" className="block text-xs font-semibold text-neutral-700">
                    Additional details <span className="text-neutral-400 font-normal">(optional)</span>
                  </label>
                  {additionalDetailsInput.trim() !== '' && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setAdditionalDetailsInput('')}
                      className="text-[11px] font-medium text-neutral-500 hover:text-[#111111] underline cursor-pointer disabled:opacity-50"
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
                  className="w-full px-3.5 py-2 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] focus-visible:border-[#111111] transition-colors resize-y disabled:opacity-60"
                />
              </div>

              {/* Footer Actions */}
              <div className="pt-3 border-t border-black/[0.06] flex items-center justify-end gap-2.5 pb-[env(safe-area-inset-bottom,0px)]">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-[44px] px-5 py-2 text-xs font-semibold text-white bg-[#111111] hover:bg-black rounded-xl transition-colors shadow-xs flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#87CEEB]" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>{editingNote ? 'Save Changes' : 'Save Note'}</span>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
