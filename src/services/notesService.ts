/**
 * XOS Notes Supabase CRUD Service
 * Persists independent user notes strictly in public.notes under authenticated RLS isolation.
 * Never uses browser-local storage, mock records, or automatic financial ledger mutations.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';
import { Note, NoteFormInput } from '../types/notes';
import { sanitizeDatabaseErrorMessage } from '../utils/authValidation';
import { normalizeNoteType, validateNoteInput } from '../utils/noteValidation';

interface DbNoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  note_type: string;
  estimated_amount: number | string | null;
  target_date: string | null;
  additional_details: string | null;
  created_at: string;
  updated_at: string;
}

const NOTE_SELECT_COLUMNS =
  'id, user_id, title, content, note_type, estimated_amount, target_date, additional_details, created_at, updated_at';

let activeSupabaseClient: SupabaseClient = supabase;
let configuredOverride: boolean | null = null;

export function configureNotesClientForTests(
  clientOverride: SupabaseClient | null,
  backendActiveOverride: boolean | null
): void {
  activeSupabaseClient = clientOverride || supabase;
  configuredOverride = backendActiveOverride;
}

function isBackendActive(): boolean {
  return configuredOverride !== null ? configuredOverride : isSupabaseConfigured;
}

function mapDbRowToNote(row: DbNoteRow): Note {
  let estimatedAmount: number | null = null;
  if (row.estimated_amount !== null && row.estimated_amount !== undefined && row.estimated_amount !== '') {
    const num = typeof row.estimated_amount === 'number' ? row.estimated_amount : Number(row.estimated_amount);
    if (Number.isFinite(num) && num >= 0) {
      estimatedAmount = Number(num.toFixed(2));
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content ?? '',
    noteType: normalizeNoteType(row.note_type),
    estimatedAmount,
    targetDate: row.target_date || null,
    additionalDetails: row.additional_details ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

async function requireAuthenticatedUserId(): Promise<string> {
  if (!isBackendActive()) {
    throw new Error('Supabase connection is required to store and manage notes.');
  }
  const { data, error } = await activeSupabaseClient.auth.getSession();
  if (error) {
    throw new Error(sanitizeDatabaseErrorMessage(error, 'Your session has expired. Please sign in again.'));
  }
  const userId = data?.session?.user?.id;
  if (!userId) {
    throw new Error('Please sign in to access your personal notes.');
  }
  return userId;
}

export const notesService = {
  async listNotes(signal?: AbortSignal): Promise<Note[]> {
    const userId = await requireAuthenticatedUserId();

    let query = activeSupabaseClient
      .from('notes')
      .select(NOTE_SELECT_COLUMNS)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (signal && typeof (query as unknown as { abortSignal?: (s: AbortSignal) => typeof query }).abortSignal === 'function') {
      query = (query as unknown as { abortSignal: (s: AbortSignal) => typeof query }).abortSignal(signal);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not load notes. Please try again.'));
    }

    return ((data as DbNoteRow[] | null) || []).map(mapDbRowToNote);
  },

  async createNote(input: NoteFormInput): Promise<Note> {
    const validation = validateNoteInput(input);
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const userId = await requireAuthenticatedUserId();
    const { payload } = validation;

    const { data, error } = await activeSupabaseClient
      .from('notes')
      .insert({
        user_id: userId,
        title: payload.title,
        content: payload.content,
        note_type: payload.noteType,
        estimated_amount: payload.estimatedAmount,
        target_date: payload.targetDate,
        additional_details: payload.additionalDetails
      })
      .select(NOTE_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not save note. Please try again.'));
    }

    return mapDbRowToNote(data as DbNoteRow);
  },

  async updateNote(noteId: string, input: NoteFormInput, expectedUpdatedAt?: string): Promise<Note> {
    if (!noteId || typeof noteId !== 'string') {
      throw new Error('Note ID is required.');
    }

    const validation = validateNoteInput(input);
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const userId = await requireAuthenticatedUserId();
    const { payload } = validation;

    let query = activeSupabaseClient
      .from('notes')
      .update({
        title: payload.title,
        content: payload.content,
        note_type: payload.noteType,
        estimated_amount: payload.estimatedAmount,
        target_date: payload.targetDate,
        additional_details: payload.additionalDetails
      })
      .eq('id', noteId)
      .eq('user_id', userId);

    if (expectedUpdatedAt) {
      query = query.eq('updated_at', expectedUpdatedAt);
    }

    const { data, error } = await query.select(NOTE_SELECT_COLUMNS).maybeSingle();

    if (error) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not update note. Please try again.'));
    }
    if (!data) {
      throw new Error('This note was updated or removed elsewhere. Please refresh and try again.');
    }

    return mapDbRowToNote(data as DbNoteRow);
  },

  async deleteNote(noteId: string): Promise<void> {
    if (!noteId || typeof noteId !== 'string') {
      throw new Error('Note ID is required.');
    }

    const userId = await requireAuthenticatedUserId();

    const { data, error } = await activeSupabaseClient
      .from('notes')
      .delete()
      .eq('id', noteId)
      .eq('user_id', userId)
      .select('id');

    if (error) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not delete note. Please try again.'));
    }
    if (!data || data.length === 0) {
      throw new Error('Note could not be deleted or was not found.');
    }
  }
};
