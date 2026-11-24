/**
 * XOS Jarvis AI Agent — Chat History, Conversation Management & RLS Isolation Suite
 *
 * Tests:
 * 1. Title generation, IST date bucketing, newest-first sorting, pinning/archiving grouping, metadata sanitization
 * 2. Mobile long-press gesture controller (450ms hold, <450ms normal tap, >8px scroll cancellation, click suppression)
 * 3. Two-user RLS-enforcing Supabase simulator covering full CRUD, conversation isolation, idempotent retries, cascade delete, and cross-user denial
 * 4. SQL migration security invariants + zero localStorage/sessionStorage/indexedDB/service_role checks
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  chatHistoryService,
  configureChatHistoryClientForTests,
  resetChatHistoryMemoryForTests
} from '../services/ai/chatHistoryService';
import { AiConversation } from '../services/ai/chatHistoryTypes';
import {
  formatConversationTimestamp,
  generateConversationTitleFromMessage,
  getConversationDateBucket,
  organizeConversations,
  sanitizeMessageMetadata
} from '../services/ai/chatHistoryUtils';
import {
  DEFAULT_LONG_PRESS_DELAY_MS,
  LONG_PRESS_MOVE_THRESHOLD_PX,
  LongPressController
} from '../services/ai/longPressGesture';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Chat History test assertion failed: ${message}`);
  }
}

async function assertRejects(fn: () => Promise<unknown>, expectedPattern: RegExp, label: string) {
  let rejected = false;
  try {
    await fn();
  } catch (err) {
    rejected = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert(expectedPattern.test(msg), `${label} — unexpected error message: ${msg}`);
  }
  assert(rejected, `${label} — expected promise rejection`);
}

interface SimConversationRow {
  id: string;
  user_id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  language_preference: string;
  last_message_preview: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

interface SimMessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'model';
  content: string;
  message_metadata: Record<string, unknown>;
  client_message_id: string;
  created_at: string;
}

/**
 * Stateful PostgreSQL + RLS simulator enforcing the policies & triggers in
 * supabase/migrations/20261124_ai_chat_history.sql.
 */
function createRlsSupabaseSimulator() {
  let activeUserId: string | null = null;
  let idCounter = 0;
  let tickMs = Date.parse('2026-11-24T10:00:00.000Z');
  const conversations: SimConversationRow[] = [];
  const messages: SimMessageRow[] = [];

  const nextId = (prefix: string) => {
    idCounter += 1;
    return `${prefix}-0000-0000-0000-${String(idCounter).padStart(12, '0')}`;
  };

  const nextIso = () => {
    tickMs += 1000;
    return new Date(tickMs).toISOString();
  };

  const makeBuilder = (table: 'ai_conversations' | 'ai_messages') => {
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

    const canAccessConversation = (row: SimConversationRow) =>
      Boolean(activeUserId) && row.user_id === activeUserId;

    const canAccessMessage = (row: SimMessageRow) => {
      if (!activeUserId || row.user_id !== activeUserId) return false;
      const parent = conversations.find(c => c.id === row.conversation_id);
      return Boolean(parent && parent.user_id === activeUserId);
    };

    const execute = async (): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
      if (op === 'select') {
        if (table === 'ai_conversations') {
          let rows = conversations.filter(c => canAccessConversation(c) && matchFilters(c as unknown as Record<string, unknown>));
          if (orderCol) {
            rows = [...rows].sort((a, b) => {
              const av = String((a as unknown as Record<string, unknown>)[orderCol!] || '');
              const bv = String((b as unknown as Record<string, unknown>)[orderCol!] || '');
              return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            });
          }
          if (expectsSingle) {
            if (rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
            return { data: { ...rows[0] }, error: null };
          }
          if (expectsMaybeSingle) {
            return { data: rows[0] ? { ...rows[0] } : null, error: null };
          }
          return { data: rows.map(r => ({ ...r })), error: null };
        }

        let rows = messages.filter(m => canAccessMessage(m) && matchFilters(m as unknown as Record<string, unknown>));
        if (orderCol) {
          rows = [...rows].sort((a, b) => {
            const av = String((a as unknown as Record<string, unknown>)[orderCol!] || '');
            const bv = String((b as unknown as Record<string, unknown>)[orderCol!] || '');
            return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
        if (expectsSingle) {
          if (rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
          return { data: { ...rows[0] }, error: null };
        }
        if (expectsMaybeSingle) {
          return { data: rows[0] ? { ...rows[0] } : null, error: null };
        }
        return { data: rows.map(r => ({ ...r })), error: null };
      }

      if (op === 'insert') {
        const p = payload || {};
        if (table === 'ai_conversations') {
          if (!activeUserId || p.user_id !== activeUserId) {
            return { data: null, error: { message: 'new row violates row-level security policy for table "ai_conversations"' } };
          }
          const title = String(p.title || '').trim();
          if (!title || title.length > 120) {
            return { data: null, error: { message: 'check constraint violation on title' } };
          }
          const now = nextIso();
          const row: SimConversationRow = {
            id: nextId('conv'),
            user_id: activeUserId,
            title,
            pinned: Boolean(p.pinned),
            archived: Boolean(p.archived),
            language_preference: String(p.language_preference || 'ml-IN'),
            last_message_preview: String(p.last_message_preview || ''),
            created_at: String(p.created_at || now),
            updated_at: String(p.updated_at || now),
            last_message_at: String(p.last_message_at || now)
          };
          conversations.push(row);
          return { data: wantsSelectAfterWrite ? (expectsSingle ? { ...row } : [{ ...row }]) : null, error: null };
        }

        // ai_messages insert: RLS checks user_id === auth.uid() AND parent conversation owned by auth.uid()
        const convId = String(p.conversation_id || '');
        const parent = conversations.find(c => c.id === convId);
        if (!activeUserId || p.user_id !== activeUserId || !parent || parent.user_id !== activeUserId) {
          return { data: null, error: { message: 'new row violates row-level security policy for table "ai_messages"' } };
        }
        const content = String(p.content || '');
        if (!content.trim()) {
          return { data: null, error: { message: 'check constraint violation on content' } };
        }
        const clientMessageId = String(p.client_message_id || '');
        if (messages.some(m => m.conversation_id === convId && m.client_message_id === clientMessageId)) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_ai_messages_conv_client_id"' }
          };
        }
        const now = nextIso();
        const row: SimMessageRow = {
          id: nextId('msg'),
          conversation_id: convId,
          user_id: activeUserId,
          role: p.role as 'user' | 'model',
          content,
          message_metadata: (p.message_metadata as Record<string, unknown>) || {},
          client_message_id: clientMessageId,
          created_at: String(p.created_at || now)
        };
        messages.push(row);
        // Simulate AFTER INSERT trigger updating parent conversation
        parent.last_message_at = row.created_at;
        parent.updated_at = now;
        parent.last_message_preview = content.replace(/\s+/g, ' ').trim().slice(0, 100);
        return { data: wantsSelectAfterWrite ? (expectsSingle ? { ...row } : [{ ...row }]) : null, error: null };
      }

      if (op === 'update') {
        if (table === 'ai_conversations') {
          const matched = conversations.filter(
            c => canAccessConversation(c) && matchFilters(c as unknown as Record<string, unknown>)
          );
          const p = payload || {};
          for (const row of matched) {
            if ('user_id' in p && p.user_id !== row.user_id) {
              return { data: null, error: { message: 'Conversation ownership (user_id) cannot be reassigned.' } };
            }
            if ('title' in p) {
              const t = String(p.title || '').trim();
              if (!t || t.length > 120) {
                return { data: null, error: { message: 'check constraint violation on title' } };
              }
              row.title = t;
            }
            if ('pinned' in p) row.pinned = Boolean(p.pinned);
            if ('archived' in p) row.archived = Boolean(p.archived);
            if ('language_preference' in p) row.language_preference = String(p.language_preference);
            if ('last_message_preview' in p) row.last_message_preview = String(p.last_message_preview);
            if ('last_message_at' in p) row.last_message_at = String(p.last_message_at);
            row.updated_at = String(p.updated_at || nextIso());
          }
          if (expectsSingle) {
            if (matched.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
            return { data: { ...matched[0] }, error: null };
          }
          return { data: wantsSelectAfterWrite ? matched.map(r => ({ ...r })) : null, error: null };
        }
        return { data: null, error: { message: 'Direct message updates are restricted.' } };
      }

      // delete
      if (table === 'ai_conversations') {
        const toDeleteIds = new Set(
          conversations
            .filter(c => canAccessConversation(c) && matchFilters(c as unknown as Record<string, unknown>))
            .map(c => c.id)
        );
        const removed = conversations.filter(c => toDeleteIds.has(c.id));
        for (let i = conversations.length - 1; i >= 0; i--) {
          if (toDeleteIds.has(conversations[i].id)) conversations.splice(i, 1);
        }
        // ON DELETE CASCADE
        for (let i = messages.length - 1; i >= 0; i--) {
          if (toDeleteIds.has(messages[i].conversation_id)) messages.splice(i, 1);
        }
        return { data: wantsSelectAfterWrite ? removed.map(r => ({ id: r.id })) : null, error: null };
      }

      const removedMsgs: SimMessageRow[] = [];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (canAccessMessage(messages[i]) && matchFilters(messages[i] as unknown as Record<string, unknown>)) {
          removedMsgs.push(messages[i]);
          messages.splice(i, 1);
        }
      }
      return { data: wantsSelectAfterWrite ? removedMsgs : null, error: null };
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
      insert: (row: Record<string, unknown>) => {
        op = 'insert';
        payload = row;
        return builder;
      },
      update: (row: Record<string, unknown>) => {
        op = 'update';
        payload = row;
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push({ col, val });
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
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

  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: activeUserId ? { user: { id: activeUserId } } : null
        },
        error: null
      })
    },
    from: (table: 'ai_conversations' | 'ai_messages') => makeBuilder(table)
  };

  return {
    client,
    setActiveUser: (uid: string | null) => {
      activeUserId = uid;
    },
    getRawCounts: () => ({
      conversations: conversations.length,
      messages: messages.length
    })
  };
}

async function runChatHistoryTests() {
  console.log('--- Running XOS AI Chat History & RLS Isolation Suite ---');
  const rootDir = path.resolve(import.meta.dirname, '..', '..');

  // ==========================================================
  // TEST 1: Title Generation, IST Date Buckets & Grouping
  // ==========================================================
  console.log('Test 1: Title generation, IST date bucketing, pinning & archiving grouping...');

  assert(
    generateConversationTitleFromMessage('  How much did I spend this month?  ') ===
      'How much did I spend this month',
    'Generates clean English conversation title from first user message'
  );
  assert(
    generateConversationTitleFromMessage('ഈ മാസം എന്റെ ചെലവുകൾ എത്രയാണ്?') ===
      'ഈ മാസം എന്റെ ചെലവുകൾ എത്രയാണ്',
    'Generates clean Malayalam title from first user message'
  );
  assert(
    generateConversationTitleFromMessage('   ...   ') === 'New Chat',
    'Falls back to New Chat for punctuation/whitespace-only messages'
  );

  const longTitle = generateConversationTitleFromMessage(
    'Compare my food, transport, utilities, and housing expenses across January through October in detail please'
  );
  assert(longTitle.endsWith('…') && longTitle.length <= 50, 'Truncates overly long first messages cleanly at word boundary');

  const nowRef = new Date('2026-11-24T12:00:00.000Z'); // 17:30 IST on 2026-11-24
  assert(
    getConversationDateBucket('2026-11-24T01:00:00.000Z', nowRef) === 'Today',
    'Classifies same IST calendar day as Today'
  );
  assert(
    getConversationDateBucket('2026-11-23T15:00:00.000Z', nowRef) === 'Yesterday',
    'Classifies previous IST day as Yesterday'
  );
  assert(
    getConversationDateBucket('2026-11-19T10:00:00.000Z', nowRef) === 'Previous 7 days',
    'Classifies 5 days ago as Previous 7 days'
  );
  assert(
    getConversationDateBucket('2026-10-01T10:00:00.000Z', nowRef) === 'Older',
    'Classifies >7 days ago as Older'
  );
  assert(
    formatConversationTimestamp('2026-11-23T10:00:00.000Z', nowRef) === 'Yesterday',
    'Formats yesterday conversation timestamp clearly'
  );

  const baseConv = (overrides: Partial<AiConversation>): AiConversation => ({
    id: 'c',
    userId: 'u1',
    title: 'Test',
    pinned: false,
    archived: false,
    languagePreference: 'ml-IN',
    lastMessagePreview: 'Preview',
    createdAt: '2026-11-24T08:00:00.000Z',
    updatedAt: '2026-11-24T08:00:00.000Z',
    lastMessageAt: '2026-11-24T08:00:00.000Z',
    ...overrides
  });

  const organized = organizeConversations(
    [
      baseConv({ id: 'c_old', title: 'Old', lastMessageAt: '2026-10-10T10:00:00.000Z' }),
      baseConv({ id: 'c_pinned', title: 'Pinned', pinned: true, lastMessageAt: '2026-11-24T09:00:00.000Z' }),
      baseConv({ id: 'c_today', title: 'Today', lastMessageAt: '2026-11-24T11:00:00.000Z' }),
      baseConv({ id: 'c_arch', title: 'Archived', archived: true, pinned: true, lastMessageAt: '2026-11-24T11:30:00.000Z' })
    ],
    nowRef
  );

  assert(organized.pinned.length === 1 && organized.pinned[0].id === 'c_pinned', 'Pinned section contains non-archived pinned chat only');
  assert(organized.archived.length === 1 && organized.archived[0].id === 'c_arch', 'Archived section retains archived chat');
  const recentIds = organized.recentGroups.flatMap(g => g.items.map(i => i.id));
  assert(
    !recentIds.includes('c_pinned') && !recentIds.includes('c_arch') && recentIds.includes('c_today') && recentIds.includes('c_old'),
    'Pinned and archived conversations are never duplicated in Recent buckets'
  );

  const sanitizedMeta = sanitizeMessageMetadata({
    langHint: 'ml',
    modules: ['expenses', 'debts'],
    actionType: 'read_only_query',
    accessToken: 'secret-jwt',
    apiKey: 'secret-key'
  } as never);
  assert(
    sanitizedMeta.langHint === 'ml' &&
      !('accessToken' in sanitizedMeta) &&
      !('apiKey' in sanitizedMeta),
    'sanitizeMessageMetadata strips secrets/tokens from persisted metadata'
  );

  // ==========================================================
  // TEST 2: Mobile Long-Press Gesture Controller
  // ==========================================================
  console.log('Test 2: Mobile long-press gesture (450ms hold, scroll cancel, normal tap)...');

  // 2a. Normal quick tap (<450ms) does NOT open menu and allows tap click
  let longPressFired = 0;
  const tapCtrl = new LongPressController({
    delayMs: 50,
    onLongPress: () => {
      longPressFired += 1;
    }
  });
  tapCtrl.start(100, 200);
  await new Promise(r => setTimeout(r, 15));
  tapCtrl.end();
  await new Promise(r => setTimeout(r, 50));
  assert(longPressFired === 0, 'Short tap does not trigger long-press menu');
  assert(tapCtrl.consumeTriggeredClick() === false, 'Short tap allows normal click selection');

  // 2b. Touch move beyond threshold (scroll) cancels long-press cleanly
  longPressFired = 0;
  const scrollCtrl = new LongPressController({
    delayMs: 40,
    moveThresholdPx: LONG_PRESS_MOVE_THRESHOLD_PX,
    onLongPress: () => {
      longPressFired += 1;
    }
  });
  scrollCtrl.start(100, 200);
  scrollCtrl.move(100, 200 + LONG_PRESS_MOVE_THRESHOLD_PX + 4);
  await new Promise(r => setTimeout(r, 60));
  assert(longPressFired === 0, 'Scrolling (>8px movement) cancels long-press menu');
  assert(scrollCtrl.consumeTriggeredClick() === false, 'Cancelled scroll does not mark long-press click');

  // 2c. Sustained long press fires onLongPress and suppresses trailing synthetic click
  longPressFired = 0;
  const holdCtrl = new LongPressController({
    delayMs: 40,
    onLongPress: () => {
      longPressFired += 1;
    }
  });
  assert(DEFAULT_LONG_PRESS_DELAY_MS === 450, 'Default production long-press delay is 450ms');
  holdCtrl.start(100, 200);
  holdCtrl.move(102, 202); // micro-jitter <= 8px still counts as hold
  await new Promise(r => setTimeout(r, 60));
  holdCtrl.end();
  assert(longPressFired === 1, 'Sustained hold opens long-press action menu exactly once');
  assert(holdCtrl.consumeTriggeredClick() === true, 'First click after long-press is consumed to avoid opening row');
  assert(holdCtrl.consumeTriggeredClick() === false, 'Subsequent normal tap is not consumed');

  // ==========================================================
  // TEST 3: Persistent Multi-User CRUD, Isolation & RLS Simulator
  // ==========================================================
  console.log('Test 3: Multi-user Supabase RLS simulator & chatHistoryService...');

  const sim = createRlsSupabaseSimulator();
  configureChatHistoryClientForTests(sim.client as never, true);

  try {
    // 3a. Unauthenticated requests must fail immediately
    sim.setActiveUser(null);
    await assertRejects(() => chatHistoryService.listConversations(), /sign in/i, 'Rejects unauthenticated listConversations');
    await assertRejects(() => chatHistoryService.createConversation(), /sign in/i, 'Rejects unauthenticated createConversation');

    // 3b. User A creates Conversation 1 (Malayalam) and Conversation 2 (English)
    sim.setActiveUser('user-A');
    const convA1 = await chatHistoryService.createConversation({
      title: 'New Chat',
      languagePreference: 'ml-IN'
    });
    const convA2 = await chatHistoryService.createConversation({
      title: 'New Chat',
      languagePreference: 'en-IN'
    });

    await chatHistoryService.saveMessage({
      conversationId: convA1.id,
      role: 'user',
      content: 'ഈ മാസം എന്റെ ചെലവുകൾ എത്രയാണ്?',
      clientMessageId: 'cmsg-a1-u1',
      metadata: { langHint: 'ml', modules: ['expenses'] }
    });
    await chatHistoryService.saveMessage({
      conversationId: convA1.id,
      role: 'model',
      content: 'ഈ മാസം ചെലവ് ₹4,500 ആണ്.',
      clientMessageId: 'cmsg-a1-m1',
      metadata: { langHint: 'ml', modules: ['expenses'], actionType: 'read_only_query' }
    });

    await chatHistoryService.saveMessage({
      conversationId: convA2.id,
      role: 'user',
      content: 'How much savings do I have?',
      clientMessageId: 'cmsg-a2-u1',
      metadata: { langHint: 'en', modules: ['savings'] }
    });

    // Idempotent retry test: repeating same clientMessageId MUST NOT duplicate row
    await chatHistoryService.saveMessage({
      conversationId: convA2.id,
      role: 'user',
      content: 'How much savings do I have?',
      clientMessageId: 'cmsg-a2-u1',
      metadata: { langHint: 'en', modules: ['savings'] }
    });

    const msgsA1 = await chatHistoryService.getMessages(convA1.id);
    const msgsA2 = await chatHistoryService.getMessages(convA2.id);
    assert(msgsA1.length === 2 && msgsA1[0].content.includes('ചെലവുകൾ'), 'Conv A1 retains exact 2 messages');
    assert(msgsA2.length === 1 && msgsA2[0].content === 'How much savings do I have?', 'Conv A2 retains exact 1 message after idempotent retry (zero cross-conversation leakage)');

    const listA = await chatHistoryService.listConversations();
    assert(listA.length === 2, 'User A lists both conversations');
    const reloadedA1 = listA.find(c => c.id === convA1.id)!;
    assert(reloadedA1.title === 'ഈ മാസം എന്റെ ചെലവുകൾ എത്രയാണ്', 'Auto-generated Malayalam title from first user message');
    assert(reloadedA1.languagePreference === 'ml-IN', 'Preserved per-conversation language ml-IN');

    // Empty message & empty title validation
    await assertRejects(
      () => chatHistoryService.saveMessage({ conversationId: convA1.id, role: 'user', content: '   ' }),
      /empty/i,
      'Rejects empty whitespace message'
    );
    await assertRejects(
      () => chatHistoryService.updateConversationTitle(convA1.id, '   '),
      /empty/i,
      'Rejects empty whitespace conversation title'
    );

    // Rename, Pin/Unpin, Archive/Restore
    const renamed = await chatHistoryService.updateConversationTitle(convA1.id, 'Monthly Expense Check');
    assert(renamed.title === 'Monthly Expense Check', 'Renames conversation cleanly');
    const pinned = await chatHistoryService.setConversationPinned(convA1.id, true);
    assert(pinned.pinned === true, 'Pins conversation');
    const unpinned = await chatHistoryService.setConversationPinned(convA1.id, false);
    assert(unpinned.pinned === false, 'Unpins conversation');
    const archived = await chatHistoryService.setConversationArchived(convA1.id, true);
    assert(archived.archived === true, 'Archives conversation');
    assert((await chatHistoryService.getMessages(convA1.id)).length === 2, 'Archived conversation retains all messages');
    const restored = await chatHistoryService.setConversationArchived(convA1.id, false);
    assert(restored.archived === false, 'Restores archived conversation');

    // 3c. TWO-USER CROSS-TENANT RLS ISOLATION
    sim.setActiveUser('user-B');
    const listBEmpty = await chatHistoryService.listConversations();
    assert(listBEmpty.length === 0, 'User B cannot see any of User A conversations');

    const convB1 = await chatHistoryService.createConversation({
      title: 'User B Private Chat',
      languagePreference: 'auto'
    });
    assert((await chatHistoryService.listConversations()).length === 1, 'User B sees only own conversation');

    await assertRejects(
      () => chatHistoryService.getMessages(convA1.id),
      /not found/i,
      'User B cannot read User A messages'
    );
    await assertRejects(
      () =>
        chatHistoryService.saveMessage({
          conversationId: convA1.id,
          role: 'user',
          content: 'Injected cross-tenant message'
        }),
      /not found|permission/i,
      'User B cannot inject messages into User A conversation'
    );
    await assertRejects(
      () => chatHistoryService.updateConversationTitle(convA1.id, 'Hacked'),
      /rename|permission|found/i,
      'User B cannot rename User A conversation'
    );
    await assertRejects(
      () => chatHistoryService.setConversationPinned(convA1.id, true),
      /pin|permission|found/i,
      'User B cannot pin User A conversation'
    );
    await assertRejects(
      () => chatHistoryService.setConversationArchived(convA1.id, true),
      /archive|permission|found/i,
      'User B cannot archive User A conversation'
    );
    await assertRejects(
      () => chatHistoryService.deleteConversation(convA1.id),
      /deleted|not found|permission/i,
      'User B cannot delete User A conversation'
    );

    // Verify direct RLS policy enforcement even if someone crafts a raw Supabase client call without user_id filter
    const rawDirectAttempt = await sim.client
      .from('ai_messages')
      .insert({
        conversation_id: convA1.id,
        user_id: 'user-B',
        role: 'user',
        content: 'Raw RLS bypass test',
        client_message_id: 'bypass-1',
        message_metadata: {}
      });
    assert(Boolean((rawDirectAttempt as { error: unknown }).error), 'Raw DB RLS blocks cross-user message insert');

    // Switch back to User A and confirm ALL messages & titles are intact, then test permanent cascade delete
    sim.setActiveUser('user-A');
    const verifyA1 = await chatHistoryService.getMessages(convA1.id);
    assert(verifyA1.length === 2, 'User A conversation remained untouched by User B');

    const countBeforeDelete = sim.getRawCounts();
    await chatHistoryService.deleteConversation(convA1.id);
    const countAfterDelete = sim.getRawCounts();
    assert(
      countAfterDelete.conversations === countBeforeDelete.conversations - 1 &&
        countAfterDelete.messages === countBeforeDelete.messages - 2,
      'Deleting conversation permanently cascades delete to its messages while keeping convA2 & convB1'
    );
    await assertRejects(
      () => chatHistoryService.deleteConversation(convA1.id),
      /not found|deleted/i,
      'Deleting already-deleted conversation fails honestly instead of returning false success'
    );
    assert(convB1.userId === 'user-B', 'User B conversation unaffected');
  } finally {
    configureChatHistoryClientForTests(null, null);
    resetChatHistoryMemoryForTests();
  }

  // ==========================================================
  // TEST 4: SQL Migration & Client Security Static Audit
  // ==========================================================
  console.log('Test 4: SQL migration RLS + no browser storage / service_role / console audit...');

  const migrationSql = fs.readFileSync(
    path.join(rootDir, 'supabase/migrations/20261124_ai_chat_history.sql'),
    'utf8'
  );
  for (const requiredSql of [
    'CREATE TABLE IF NOT EXISTS public.ai_conversations',
    'CREATE TABLE IF NOT EXISTS public.ai_messages',
    'ON DELETE CASCADE',
    'uq_ai_messages_conv_client_id',
    'ENABLE ROW LEVEL SECURITY',
    'user_id = auth.uid()',
    'trg_ai_conversations_immutable_owner',
    'trg_ai_messages_validate_ownership',
    'trg_ai_messages_sync_conversation'
  ]) {
    assert(migrationSql.includes(requiredSql), `Migration SQL includes ${requiredSql}`);
  }

  const chatFiles = [
    'src/services/ai/chatHistoryTypes.ts',
    'src/services/ai/chatHistoryUtils.ts',
    'src/services/ai/chatHistoryService.ts',
    'src/services/ai/longPressGesture.ts',
    'src/components/ai/NewChatButton.tsx',
    'src/components/ai/ChatActionMenu.tsx',
    'src/components/ai/DeleteConversationDialog.tsx',
    'src/components/ai/ChatHistoryItem.tsx',
    'src/components/ai/PinnedChatsSection.tsx',
    'src/components/ai/ChatHistoryList.tsx',
    'src/components/ai/ArchivedChatsView.tsx',
    'src/components/ai/ChatHistoryPanel.tsx',
    'src/components/ai/AiAgentView.tsx'
  ];

  for (const rel of chatFiles) {
    const src = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    assert(!/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/.test(src), `Zero browser storage in ${rel}`);
    assert(!/service_role|SUPABASE_SERVICE_ROLE/i.test(src), `Zero service_role in ${rel}`);
    assert(!/console\.(log|warn|error)\s*\(/.test(src), `Zero console logs in ${rel}`);
    assert(!src.includes('dangerouslySetInnerHTML'), `Zero dangerouslySetInnerHTML in ${rel}`);
  }

  const historyItemSrc = fs.readFileSync(path.join(rootDir, 'src/components/ai/ChatHistoryItem.tsx'), 'utf8');
  assert(
    historyItemSrc.includes('select-none') &&
      historyItemSrc.includes('touch-pan-y') &&
      historyItemSrc.includes('onContextMenu'),
    'ChatHistoryItem enforces mobile touch callout/text-selection prevention and scroll safety'
  );

  const deleteDialogSrc = fs.readFileSync(path.join(rootDir, 'src/components/ai/DeleteConversationDialog.tsx'), 'utf8');
  assert(
    deleteDialogSrc.includes('ConfirmDialog') && deleteDialogSrc.includes('cannot be undone'),
    'DeleteConversationDialog requires explicit destructive confirmation'
  );

  const aiViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/ai/AiAgentView.tsx'), 'utf8');
  assert(
    aiViewSrc.includes('if (conv.archived) return;'),
    'AiAgentView prevents archived conversations from becoming active input threads'
  );

  console.log('ALL XOS AI CHAT HISTORY & RLS ISOLATION TESTS PASSED SUCCESSFULLY!');
}

runChatHistoryTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
