/**
 * Validation, Formatting & Filtering Helpers for XOS Notes
 */
import {
  ALLOWED_NOTE_TYPES,
  Note,
  NoteFormInput,
  NoteSortOrder,
  NoteType,
  NoteTypeFilter,
  ValidatedNotePayload
} from '../types/notes';
import { formatCurrency, isValidCalendarDateString } from './formatters';

export const MAX_NOTE_TITLE_LENGTH = 200;
export const MAX_NOTE_CONTENT_LENGTH = 20000;
export const MAX_NOTE_DETAILS_LENGTH = 5000;
export const MAX_ESTIMATED_AMOUNT = 9999999999.99;

export type NoteValidationResult =
  | { ok: true; payload: ValidatedNotePayload }
  | { ok: false; error: string };

export function normalizeNoteType(raw?: unknown): NoteType {
  if (typeof raw === 'string' && ALLOWED_NOTE_TYPES.has(raw as NoteType)) {
    return raw as NoteType;
  }
  return 'general';
}

export function parseOptionalEstimatedAmount(
  raw: string | number | null | undefined
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { ok: false, error: 'Estimated budget must be a valid number.' };
    }
    if (raw < 0) {
      return { ok: false, error: 'Estimated budget cannot be negative.' };
    }
    if (raw > MAX_ESTIMATED_AMOUNT) {
      return { ok: false, error: 'Estimated budget exceeds the maximum supported amount.' };
    }
    return { ok: true, value: Number(raw.toFixed(2)) };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  // Allow optional ₹ prefix and thousands commas, reject negative or non-numeric garbage
  const stripped = trimmed.replace(/^₹\s*/i, '').replace(/,/g, '').trim();
  if (stripped.startsWith('-')) {
    return { ok: false, error: 'Estimated budget cannot be negative.' };
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(stripped)) {
    return { ok: false, error: 'Enter a valid non-negative estimated budget (up to 2 decimal places).' };
  }

  const parsed = Number(stripped);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: 'Estimated budget must be a valid non-negative amount.' };
  }
  if (parsed > MAX_ESTIMATED_AMOUNT) {
    return { ok: false, error: 'Estimated budget exceeds the maximum supported amount.' };
  }

  return { ok: true, value: Number(parsed.toFixed(2)) };
}

export function parseOptionalTargetDate(
  raw: string | null | undefined
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  if (!isValidCalendarDateString(trimmed)) {
    return { ok: false, error: 'Please select a valid target date (YYYY-MM-DD).' };
  }
  return { ok: true, value: trimmed };
}

export function validateNoteInput(input: NoteFormInput): NoteValidationResult {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) {
    return { ok: false, error: 'Note title is required.' };
  }
  if (title.length > MAX_NOTE_TITLE_LENGTH) {
    return { ok: false, error: `Note title cannot exceed ${MAX_NOTE_TITLE_LENGTH} characters.` };
  }

  const contentRaw = typeof input.content === 'string' ? input.content : '';
  const contentTrimmed = contentRaw.trim();
  if (!contentTrimmed) {
    return { ok: false, error: 'Note content is required.' };
  }
  if (contentTrimmed.length > MAX_NOTE_CONTENT_LENGTH) {
    return { ok: false, error: `Note content cannot exceed ${MAX_NOTE_CONTENT_LENGTH.toLocaleString('en-IN')} characters.` };
  }

  if (input.noteType !== undefined && !ALLOWED_NOTE_TYPES.has(input.noteType)) {
    return { ok: false, error: 'Please choose a valid note type.' };
  }
  const noteType = normalizeNoteType(input.noteType);

  const amountResult = parseOptionalEstimatedAmount(input.estimatedAmountInput);
  if (!amountResult.ok) {
    return { ok: false, error: amountResult.error };
  }

  const dateResult = parseOptionalTargetDate(input.targetDateInput);
  if (!dateResult.ok) {
    return { ok: false, error: dateResult.error };
  }

  const detailsTrimmed =
    typeof input.additionalDetailsInput === 'string' ? input.additionalDetailsInput.trim() : '';
  if (detailsTrimmed.length > MAX_NOTE_DETAILS_LENGTH) {
    return { ok: false, error: `Additional details cannot exceed ${MAX_NOTE_DETAILS_LENGTH.toLocaleString('en-IN')} characters.` };
  }

  return {
    ok: true,
    payload: {
      title,
      content: contentTrimmed,
      noteType,
      estimatedAmount: amountResult.value,
      targetDate: dateResult.value,
      additionalDetails: detailsTrimmed ? detailsTrimmed : null
    }
  };
}

/**
 * Formats estimated budget strictly in INR (₹) when provided,
 * and explicitly displays "Not decided" when NULL/undefined (never ₹0).
 */
export function formatNoteBudget(estimatedAmount: number | null | undefined): string {
  if (estimatedAmount === null || estimatedAmount === undefined) {
    return 'Not decided';
  }
  return formatCurrency(estimatedAmount, 'INR');
}

export function formatNoteTimestamp(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const parsed = new Date(isoStr);
  if (isNaN(parsed.getTime())) return String(isoStr);
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function formatNoteDetailedTimestamp(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const parsed = new Date(isoStr);
  if (isNaN(parsed.getTime())) return String(isoStr);
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function filterAndSortNotes(
  notes: Note[],
  options: {
    searchQuery?: string;
    noteTypeFilter?: NoteTypeFilter;
    sortOrder?: NoteSortOrder;
  } = {}
): Note[] {
  const query = (options.searchQuery || '').trim().toLowerCase();
  const typeFilter = options.noteTypeFilter || 'all';
  const sortOrder = options.sortOrder || 'updated_desc';

  const filtered = notes.filter(note => {
    if (typeFilter !== 'all' && note.noteType !== typeFilter) {
      return false;
    }
    if (query) {
      const inTitle = note.title.toLowerCase().includes(query);
      const inContent = note.content.toLowerCase().includes(query);
      const inDetails = Boolean(note.additionalDetails && note.additionalDetails.toLowerCase().includes(query));
      if (!inTitle && !inContent && !inDetails) {
        return false;
      }
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt).getTime() || 0;
    const bTime = new Date(b.updatedAt || b.createdAt).getTime() || 0;
    return sortOrder === 'updated_asc' ? aTime - bTime : bTime - aTime;
  });
}
