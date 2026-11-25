/**
 * XOS Notes Module — CRUD, Validation, INR/Optional Budget, RLS Isolation & Responsive Audit Suite
 *
 * Covers:
 * 1. Creating notes (required Title/Content + optional Purchase Plan fields, zero financial side-effects)
 * 2. Editing notes (updatedAt advances, createdAt preserved, optimistic concurrency conflict check)
 * 3. Deleting notes (permanent delete + honest error when missing)
 * 4. Saving without estimated budget (persists NULL, displays "Not decided", never ₹0)
 * 5. Saving without target date (persists NULL)
 * 6. Clearing an existing estimated budget / target date / additional details during edit (explicit NULL)
 * 7. Searching by title/content/details, filtering by note_type, and sorting (updated_desc / updated_asc)
 * 8. Reload persistence simulation + zero localStorage/sessionStorage/indexedDB/service_role checks
 * 9. Two-user cross-tenant RLS isolation & immutable user_id enforcement
 * 10. Unauthenticated & unconfigured backend access denial
 * 11. Validation rejecting invalid/negative monetary values + INR (₹) formatting
 * 12. SQL migration, Sidebar, MobileBottomNav, App routing & mobile responsiveness checks
 */

import fs from 'node:fs';
import path from 'node:path';
import { configureNotesClientForTests, notesService } from '../services/notesService';
import {
  filterAndSortNotes,
  formatNoteBudget,
  parseOptionalEstimatedAmount,
  parseOptionalTargetDate,
  validateNoteInput
} from '../utils/noteValidation';
import { NOTE_TYPE_OPTIONS, Note } from '../types/notes';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Notes test assertion failed: ${message}`);
  }
}

async function assertRejects(fn: () => Promise<unknown>, expectedPattern: RegExp, label: string) {
  let rejected = false;
  try {
    await fn();
  } catch (err) {
    rejected = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert(expectedPattern.test(msg), `${label} — unexpected error: ${msg}`);
  }
  assert(rejected, `${label} — expected promise rejection`);
}

interface SimNoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  note_type: string;
  estimated_amount: number | null;
  target_date: string | null;
  additional_details: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_TYPES = new Set(['general', 'purchase_plan', 'personal_plan', 'shopping_list', 'reminder', 'other']);

/**
 * Stateful PostgreSQL + RLS simulator matching supabase/migrations/20261125_notes_module.sql
 */
function createNotesRlsSupabaseSimulator() {
  let activeUserId: string | null = null;
  let idCounter = 0;
  let tickMs = Date.parse('2026-11-25T09:00:00.000Z');
  const rows: SimNoteRow[] = [];
  const updatePayloads: Array<Record<string, unknown>> = [];

  const nextId = () => {
    idCounter += 1;
    return `note-0000-0000-0000-${String(idCounter).padStart(12, '0')}`;
  };

  const nextIso = () => {
    tickMs += 1000;
    return new Date(tickMs).toISOString();
  };

  const makeBuilder = (table: string) => {
    const filters: Array<{ col: string; val: unknown }> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Record<string, unknown> | null = null;
    let wantsSelectAfterWrite = false;
    let expectsSingle = false;
    let expectsMaybeSingle = false;

    const matchFilters = (row: Record<string, unknown>) =>
      filters.every(f => row[f.col] === f.val);

    const canAccess = (row: SimNoteRow) => Boolean(activeUserId) && row.user_id === activeUserId;

    const execute = async (): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
      if (table !== 'notes') {
        return { data: null, error: { message: `Unexpected table access from Notes service: ${table}` } };
      }

      if (op === 'select') {
        let matched = rows.filter(r => canAccess(r) && matchFilters(r as unknown as Record<string, unknown>));
        if (orderCol) {
          matched = [...matched].sort((a, b) => {
            const av = String((a as unknown as Record<string, unknown>)[orderCol!] || '');
            const bv = String((b as unknown as Record<string, unknown>)[orderCol!] || '');
            return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
        if (expectsSingle) {
          if (matched.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
          return { data: { ...matched[0] }, error: null };
        }
        if (expectsMaybeSingle) {
          return { data: matched[0] ? { ...matched[0] } : null, error: null };
        }
        return { data: matched.map(r => ({ ...r })), error: null };
      }

      if (op === 'insert') {
        const p = payload || {};
        if (!activeUserId || p.user_id !== activeUserId) {
          return { data: null, error: { message: 'new row violates row-level security policy for table "notes"' } };
        }
        const title = String(p.title ?? '').trim();
        const content = String(p.content ?? '');
        const noteType = String(p.note_type ?? 'general');
        if (!title || title.length > 200) {
          return { data: null, error: { message: 'check constraint violation on title' } };
        }
        if (!content.trim() || content.length > 20000) {
          return { data: null, error: { message: 'check constraint violation on content' } };
        }
        if (!VALID_TYPES.has(noteType)) {
          return { data: null, error: { message: 'check constraint violation on note_type' } };
        }
        const est = p.estimated_amount === undefined ? null : (p.estimated_amount as number | null);
        if (est !== null && (typeof est !== 'number' || !Number.isFinite(est) || est < 0)) {
          return { data: null, error: { message: 'check constraint violation on estimated_amount' } };
        }
        const now = nextIso();
        const row: SimNoteRow = {
          id: nextId(),
          user_id: activeUserId,
          title,
          content,
          note_type: noteType,
          estimated_amount: est,
          target_date: p.target_date ? String(p.target_date) : null,
          additional_details: p.additional_details ? String(p.additional_details) : null,
          created_at: now,
          updated_at: now
        };
        rows.push(row);
        return { data: wantsSelectAfterWrite ? (expectsSingle ? { ...row } : [{ ...row }]) : null, error: null };
      }

      if (op === 'update') {
        const p = payload || {};
        updatePayloads.push({ ...p });

        const matched = rows.filter(r => canAccess(r) && matchFilters(r as unknown as Record<string, unknown>));
        for (const row of matched) {
          if ('user_id' in p && p.user_id !== row.user_id) {
            return { data: null, error: { message: 'Note ownership (user_id) cannot be reassigned.' } };
          }
          if ('title' in p) {
            const t = String(p.title ?? '').trim();
            if (!t || t.length > 200) return { data: null, error: { message: 'check constraint violation on title' } };
            row.title = t;
          }
          if ('content' in p) {
            const c = String(p.content ?? '');
            if (!c.trim() || c.length > 20000) return { data: null, error: { message: 'check constraint violation on content' } };
            row.content = c;
          }
          if ('note_type' in p) {
            const nt = String(p.note_type ?? '');
            if (!VALID_TYPES.has(nt)) return { data: null, error: { message: 'check constraint violation on note_type' } };
            row.note_type = nt;
          }
          if ('estimated_amount' in p) {
            const est = p.estimated_amount as number | null;
            if (est !== null && (typeof est !== 'number' || !Number.isFinite(est) || est < 0)) {
              return { data: null, error: { message: 'check constraint violation on estimated_amount' } };
            }
            row.estimated_amount = est;
          }
          if ('target_date' in p) {
            row.target_date = p.target_date ? String(p.target_date) : null;
          }
          if ('additional_details' in p) {
            row.additional_details = p.additional_details ? String(p.additional_details) : null;
          }
          row.updated_at = nextIso();
        }
        if (expectsSingle) {
          if (matched.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
          return { data: { ...matched[0] }, error: null };
        }
        if (expectsMaybeSingle) {
          return { data: matched[0] ? { ...matched[0] } : null, error: null };
        }
        return { data: wantsSelectAfterWrite ? matched.map(r => ({ ...r })) : null, error: null };
      }

      // delete
      const removed: SimNoteRow[] = [];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (canAccess(rows[i]) && matchFilters(rows[i] as unknown as Record<string, unknown>)) {
          removed.push({ ...rows[i] });
          rows.splice(i, 1);
        }
      }
      return { data: wantsSelectAfterWrite ? removed.map(r => ({ id: r.id })) : null, error: null };
    };

    interface SimResult {
      data: unknown;
      error: { code?: string; message: string } | null;
    }

    interface SimQueryBuilder {
      select: () => SimQueryBuilder;
      insert: (row: Record<string, unknown>) => SimQueryBuilder;
      update: (row: Record<string, unknown>) => SimQueryBuilder;
      delete: () => SimQueryBuilder;
      eq: (col: string, val: unknown) => SimQueryBuilder;
      order: (col: string, opts?: { ascending?: boolean }) => SimQueryBuilder;
      single: () => Promise<SimResult>;
      maybeSingle: () => Promise<SimResult>;
      then: <TResult1 = SimResult, TResult2 = never>(
        onfulfilled?: ((value: SimResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) => Promise<TResult1 | TResult2>;
    }

    const builder: SimQueryBuilder = {
      select: () => {
        if (op !== 'select') wantsSelectAfterWrite = true;
        return builder;
      },
      insert: (row) => {
        op = 'insert';
        payload = row;
        return builder;
      },
      update: (row) => {
        op = 'update';
        payload = row;
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      eq: (col, val) => {
        filters.push({ col, val });
        return builder;
      },
      order: (col, opts) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      single: () => {
        expectsSingle = true;
        return execute();
      },
      maybeSingle: () => {
        expectsMaybeSingle = true;
        return execute();
      },
      then: (onfulfilled, onrejected) => execute().then(onfulfilled, onrejected)
    };

    return builder;
  };

  return {
    client: {
      auth: {
        getSession: async () => ({
          data: {
            session: activeUserId ? { user: { id: activeUserId } } : null
          },
          error: null
        })
      },
      from: (table: string) => makeBuilder(table)
    },
    setActiveUser: (uid: string | null) => {
      activeUserId = uid;
    },
    getRawRows: () => rows.map(r => ({ ...r })),
    getLastUpdatePayload: () => updatePayloads[updatePayloads.length - 1] || null
  };
}

async function runNotesTests() {
  console.log('--- Running XOS Notes Module Test Suite ---');
  const rootDir = path.resolve(import.meta.dirname, '..', '..');

  // =========================================================================
  // TEST 1 & 11: Validation, Negative Monetary Rejection & INR Formatting
  // =========================================================================
  console.log('Test 1 & 11: Input validation, negative budget rejection & INR formatting...');

  assert(formatNoteBudget(null) === 'Not decided', 'NULL budget must display "Not decided", never ₹0');
  assert(formatNoteBudget(undefined) === 'Not decided', 'Undefined budget must display "Not decided"');
  assert(formatNoteBudget(45000) === '₹45,000', 'Entered INR amount formats with ₹ symbol');
  assert(formatNoteBudget(1250.5) === '₹1,250.50', 'Decimal INR amount preserves 2 decimal places');
  assert(formatNoteBudget(0) === '₹0', 'Explicit numeric 0 formats as ₹0 while NULL stays Not decided');

  for (const invalidBudget of ['-100', '-0.01', 'abc', '12.345', '₹-50', Number.NaN, Number.POSITIVE_INFINITY, -500]) {
    const parsed = parseOptionalEstimatedAmount(invalidBudget);
    assert(!parsed.ok, `Rejects invalid/negative estimated budget: ${String(invalidBudget)}`);
  }

  const validEmptyBudget = parseOptionalEstimatedAmount('   ');
  assert(validEmptyBudget.ok && validEmptyBudget.value === null, 'Blank budget string parses to NULL');

  const validWithSymbol = parseOptionalEstimatedAmount('₹ 75,500.50');
  assert(validWithSymbol.ok && validWithSymbol.value === 75500.5, 'Parses INR-formatted numeric input cleanly');

  const invalidDate = parseOptionalTargetDate('2026-02-30');
  assert(!invalidDate.ok, 'Rejects impossible calendar date 2026-02-30');

  const blankDate = parseOptionalTargetDate('');
  assert(blankDate.ok && blankDate.value === null, 'Blank target date parses to NULL');

  assert(!validateNoteInput({ title: '   ', content: 'Hello' }).ok, 'Rejects blank title');
  assert(!validateNoteInput({ title: 'Title', content: '   ' }).ok, 'Rejects blank content');
  assert(
    !validateNoteInput({ title: 'Test', content: 'Body', estimatedAmountInput: '-250' }).ok,
    'Rejects negative estimated budget in full note validation'
  );

  // =========================================================================
  // TEST 2–10: Full Supabase RLS Simulator CRUD, Clearing Fields, Isolation
  // =========================================================================
  console.log('Test 2–10: CRUD, optional fields, clearing NULLs, reload & multi-user RLS isolation...');

  const sim = createNotesRlsSupabaseSimulator();

  // Unconfigured backend denial
  configureNotesClientForTests(sim.client as never, false);
  await assertRejects(() => notesService.listNotes(), /Supabase connection/i, 'Denies access when Supabase unconfigured');

  configureNotesClientForTests(sim.client as never, true);

  try {
    // 10. Unauthenticated access denied
    sim.setActiveUser(null);
    await assertRejects(() => notesService.listNotes(), /sign in/i, 'Denies unauthenticated listNotes');
    await assertRejects(
      () => notesService.createNote({ title: 'Test', content: 'Body' }),
      /sign in/i,
      'Denies unauthenticated createNote'
    );
    await assertRejects(
      () => notesService.updateNote('note-1', { title: 'Test', content: 'Body' }),
      /sign in/i,
      'Denies unauthenticated updateNote'
    );
    await assertRejects(() => notesService.deleteNote('note-1'), /sign in/i, 'Denies unauthenticated deleteNote');

    // 1 & 4 & 5. Create notes with and without optional budget / target date
    sim.setActiveUser('user-A');

    // 4 & 5: Required-only note (no estimated budget, no target date, no additional details)
    const minimalNote = await notesService.createNote({
      title: 'Weekend Checklist',
      content: 'Review utility bills and renew passport appointment.'
    });
    assert(minimalNote.noteType === 'general', 'Defaults noteType to general');
    assert(minimalNote.estimatedAmount === null, 'Saving without estimated budget persists NULL');
    assert(minimalNote.targetDate === null, 'Saving without target date persists NULL');
    assert(minimalNote.additionalDetails === null, 'Saving without additional details persists NULL');
    assert(formatNoteBudget(minimalNote.estimatedAmount) === 'Not decided', 'UI formats missing budget as Not decided');

    // 1: Purchase Plan note (strictly independent — only touches `notes` table in simulator)
    const purchaseNote = await notesService.createNote({
      title: 'Things to Buy Next Month',
      content: '• Laptop\n• Clothes\n• Personal accessories',
      noteType: 'purchase_plan',
      estimatedAmountInput: '85000',
      targetDateInput: '2026-12-15',
      additionalDetailsInput: 'Wait for December sale.'
    });
    assert(purchaseNote.noteType === 'purchase_plan', 'Stores purchase_plan note_type');
    assert(purchaseNote.estimatedAmount === 85000, 'Stores optional numeric estimated_amount');
    assert(formatNoteBudget(purchaseNote.estimatedAmount) === '₹85,000', 'Formats budget in INR');
    assert(purchaseNote.targetDate === '2026-12-15', 'Stores optional target_date');

    // 3rd note for search/filter/sort verification
    const reminderNote = await notesService.createNote({
      title: 'Doctor Follow-up',
      content: 'Bring blood test report.',
      noteType: 'reminder',
      estimatedAmountInput: '',
      targetDateInput: '2026-12-01'
    });
    assert(reminderNote.estimatedAmount === null, 'Empty string estimatedAmountInput persists NULL');

    // 6. Edit note & clear existing estimated budget, target date, and additional details back to NULL
    const updatedMinimal = await notesService.updateNote(
      minimalNote.id,
      {
        title: 'Weekend Checklist (Updated)',
        content: 'Review utility bills, renew passport, and call electrician.',
        noteType: 'personal_plan',
        estimatedAmountInput: '1500',
        targetDateInput: '2026-12-05',
        additionalDetailsInput: 'Morning slot preferred.'
      },
      minimalNote.updatedAt
    );
    assert(updatedMinimal.title === 'Weekend Checklist (Updated)', 'Updates note title');
    assert(updatedMinimal.createdAt === minimalNote.createdAt, 'Preserves created_at on update');
    assert(updatedMinimal.updatedAt !== minimalNote.updatedAt, 'Advances updated_at on update');
    assert(updatedMinimal.estimatedAmount === 1500, 'Adds estimated amount during edit');

    // Stale expectedUpdatedAt concurrency check
    await assertRejects(
      () =>
        notesService.updateNote(
          minimalNote.id,
          { title: 'Stale Write', content: 'Should fail' },
          minimalNote.updatedAt
        ),
      /updated or removed/i,
      'Rejects stale optimistic concurrency update'
    );

    // Clear existing estimated budget + target date + additional details on purchaseNote
    const clearedPurchaseNote = await notesService.updateNote(
      purchaseNote.id,
      {
        title: purchaseNote.title,
        content: purchaseNote.content,
        noteType: 'purchase_plan',
        estimatedAmountInput: '',
        targetDateInput: '',
        additionalDetailsInput: ''
      },
      purchaseNote.updatedAt
    );
    const rawUpdate = sim.getLastUpdatePayload();
    assert(
      rawUpdate !== null &&
        rawUpdate.estimated_amount === null &&
        rawUpdate.target_date === null &&
        rawUpdate.additional_details === null,
      'Clearing optional fields sends explicit NULL values in UPDATE payload'
    );
    assert(clearedPurchaseNote.estimatedAmount === null, 'Cleared estimated budget becomes NULL in DB');
    assert(clearedPurchaseNote.targetDate === null, 'Cleared target date becomes NULL in DB');
    assert(clearedPurchaseNote.additionalDetails === null, 'Cleared additional details becomes NULL in DB');
    assert(formatNoteBudget(clearedPurchaseNote.estimatedAmount) === 'Not decided', 'Cleared budget renders as "Not decided"');

    // 8. Reload simulation: re-fetch from Supabase backend
    const reloadedList: Note[] = await notesService.listNotes();
    assert(reloadedList.length === 3, 'Reload fetches all 3 persisted notes from Supabase');
    assert(
      reloadedList[0].id === clearedPurchaseNote.id,
      'Default listNotes order returns most recently updated note first'
    );

    // 7. Search, filter by note_type & sort
    const searchLaptop = filterAndSortNotes(reloadedList, { searchQuery: 'laptop' });
    assert(searchLaptop.length === 1 && searchLaptop[0].id === purchaseNote.id, 'Searches inside note content');

    const searchDetails = filterAndSortNotes(reloadedList, { searchQuery: 'morning slot' });
    assert(searchDetails.length === 1 && searchDetails[0].id === minimalNote.id, 'Searches inside additional details');

    const filterReminder = filterAndSortNotes(reloadedList, { noteTypeFilter: 'reminder' });
    assert(filterReminder.length === 1 && filterReminder[0].id === reminderNote.id, 'Filters by note_type');

    const oldestFirst = filterAndSortNotes(reloadedList, { sortOrder: 'updated_asc' });
    assert(
      new Date(oldestFirst[0].updatedAt).getTime() <= new Date(oldestFirst[1].updatedAt).getTime() &&
        new Date(oldestFirst[1].updatedAt).getTime() <= new Date(oldestFirst[2].updatedAt).getTime(),
      'Sorts oldest first accurately'
    );

    // 9. Multi-user RLS isolation
    sim.setActiveUser('user-B');
    const userBNotes = await notesService.listNotes();
    assert(userBNotes.length === 0, 'User B cannot view User A notes');

    await assertRejects(
      () => notesService.updateNote(minimalNote.id, { title: 'Tampered', content: 'Hacked' }),
      /updated or removed/i,
      'User B cannot update User A note'
    );
    await assertRejects(
      () => notesService.deleteNote(minimalNote.id),
      /not found|deleted/i,
      'User B cannot delete User A note'
    );

    // Raw direct Supabase client RLS check without user_id filter
    const rawDirectRead = await sim.client.from('notes').select().eq('id', minimalNote.id).maybeSingle();
    assert(rawDirectRead.data === null, 'Raw RLS SELECT returns null for cross-user note');

    const rawDirectInsert = await sim.client.from('notes').insert({
      user_id: 'user-A',
      title: 'Cross-tenant spoof',
      content: 'Should fail RLS WITH CHECK',
      note_type: 'general'
    });
    assert(Boolean(rawDirectInsert.error), 'Raw RLS INSERT blocks spoofing another user_id');

    const noteB = await notesService.createNote({
      title: 'User B Private Note',
      content: 'Isolated user B content'
    });
    assert((await notesService.listNotes()).length === 1 && noteB.userId === 'user-B', 'User B owns only own note');

    // 3. Delete note & verify error on double-delete
    sim.setActiveUser('user-A');
    await notesService.deleteNote(reminderNote.id);
    const afterDeleteA = await notesService.listNotes();
    assert(afterDeleteA.length === 2 && !afterDeleteA.some(n => n.id === reminderNote.id), 'User A deleted own note');

    await assertRejects(
      () => notesService.deleteNote(reminderNote.id),
      /not found|deleted/i,
      'Deleting non-existent/already-deleted note fails honestly'
    );

    // User B note stays untouched
    sim.setActiveUser('user-B');
    assert((await notesService.listNotes()).length === 1, 'User A delete does not impact User B notes');
  } finally {
    configureNotesClientForTests(null, null);
  }

  // =========================================================================
  // TEST 12: Migration SQL, Navigation Wiring & Mobile Responsiveness Checks
  // =========================================================================
  console.log('Test 12: SQL migration RLS, zero localStorage, navigation & mobile checks...');

  const migrationSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261125_notes_module.sql'), 'utf8');
  for (const requiredSql of [
    'CREATE TABLE IF NOT EXISTS public.notes',
    'user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE',
    'estimated_amount NUMERIC(12, 2) NULL',
    'estimated_amount IS NULL OR estimated_amount >= 0',
    'target_date DATE NULL',
    'additional_details TEXT NULL',
    'ENABLE ROW LEVEL SECURITY',
    'CREATE POLICY "notes_select_own"',
    'CREATE POLICY "notes_insert_own"',
    'CREATE POLICY "notes_update_own"',
    'CREATE POLICY "notes_delete_own"',
    'auth.uid() = user_id',
    "SET search_path = ''"
  ]) {
    assert(migrationSql.includes(requiredSql), `Migration SQL includes ${requiredSql}`);
  }
  assert(!/SECURITY DEFINER/i.test(migrationSql), 'Notes trigger avoids unnecessary SECURITY DEFINER');

  const notesFiles = [
    'src/types/notes.ts',
    'src/utils/noteValidation.ts',
    'src/services/notesService.ts',
    'src/components/notes/NotesEmptyState.tsx',
    'src/components/notes/DeleteNoteDialog.tsx',
    'src/components/notes/NoteCard.tsx',
    'src/components/notes/NotesList.tsx',
    'src/components/notes/NoteEditor.tsx',
    'src/components/notes/NotesView.tsx'
  ];

  for (const rel of notesFiles) {
    const src = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    assert(!/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/.test(src), `Zero browser storage in ${rel}`);
    assert(!/service_role|SUPABASE_SERVICE_ROLE/i.test(src), `Zero service_role in ${rel}`);
    assert(!src.includes('dangerouslySetInnerHTML'), `Zero dangerouslySetInnerHTML in ${rel}`);
    assert(
      !/\b(addExpense|addIncome|addSavingsTransaction|createGoal|from\(['"](expenses|income|savings|goals|debts)['"]\))\b/.test(src),
      `Notes file ${rel} never creates automatic financial transactions`
    );
  }

  // Verify navigation wiring & mobile responsiveness
  const sidebarSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/Sidebar.tsx'), 'utf8');
  assert(sidebarSrc.includes("| 'notes'") && sidebarSrc.includes("id: 'notes', label: 'Notes'"), 'Sidebar includes Notes tab');

  const mobileNavSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/MobileBottomNav.tsx'), 'utf8');
  assert(
    mobileNavSrc.includes("'notes'") &&
      (mobileNavSrc.includes("handleSelectTab('notes')") ||
        (mobileNavSrc.includes("tab: 'notes'") && mobileNavSrc.includes('handleSelectTab(tab)'))),
    'MobileBottomNav includes Notes navigation'
  );

  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  assert(appSrc.includes("activeTab === 'notes'") && appSrc.includes('<NotesView />'), 'App.tsx routes to NotesView');

  const notesViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/notes/NotesView.tsx'), 'utf8');
  assert(
    notesViewSrc.includes('All Notes') && notesViewSrc.includes('mobileReaderOpen') && notesViewSrc.includes('text-base md:text-sm'),
    'NotesView provides responsive mobile reader drill-down and non-zooming mobile inputs'
  );

  const noteEditorSrc = fs.readFileSync(path.join(rootDir, 'src/components/notes/NoteEditor.tsx'), 'utf8');
  assert(
    noteEditorSrc.includes('min-h-[44px]') &&
      noteEditorSrc.includes('text-base md:text-sm') &&
      noteEditorSrc.includes('isSubmittingRef'),
    'NoteEditor enforces >=44px mobile touch targets, iOS zoom safety, and double-submit guard'
  );

  assert(NOTE_TYPE_OPTIONS.length === 6, 'Supports all 6 required NoteType options');

  console.log('ALL XOS NOTES MODULE TESTS PASSED SUCCESSFULLY!');
}

runNotesTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
