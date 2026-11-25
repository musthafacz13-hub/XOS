/**
 * XOS Notes Module Type Definitions
 * Independent user notes for general ideas, purchase plans, shopping lists, and reminders.
 */

export type NoteType =
  | 'general'
  | 'purchase_plan'
  | 'personal_plan'
  | 'shopping_list'
  | 'reminder'
  | 'other';

export type NoteTypeFilter = 'all' | NoteType;

export type NoteSortOrder = 'updated_desc' | 'updated_asc';

export interface NoteTypeOption {
  value: NoteType;
  label: string;
}

export const NOTE_TYPE_OPTIONS: readonly NoteTypeOption[] = [
  { value: 'general', label: 'General' },
  { value: 'purchase_plan', label: 'Purchase Plan' },
  { value: 'personal_plan', label: 'Personal Plan' },
  { value: 'shopping_list', label: 'Shopping List' },
  { value: 'reminder', label: 'Reminder' },
  { value: 'other', label: 'Other' }
] as const;

export const ALLOWED_NOTE_TYPES = new Set<NoteType>(NOTE_TYPE_OPTIONS.map(o => o.value));

export function getNoteTypeLabel(noteType: NoteType): string {
  return NOTE_TYPE_OPTIONS.find(o => o.value === noteType)?.label || 'General';
}

export interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  noteType: NoteType;
  estimatedAmount: number | null;
  targetDate: string | null; // YYYY-MM-DD or null
  additionalDetails: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteFormInput {
  title: string;
  content: string;
  noteType?: NoteType;
  estimatedAmountInput?: string | number | null;
  targetDateInput?: string | null;
  additionalDetailsInput?: string | null;
}

export interface ValidatedNotePayload {
  title: string;
  content: string;
  noteType: NoteType;
  estimatedAmount: number | null;
  targetDate: string | null;
  additionalDetails: string | null;
}
