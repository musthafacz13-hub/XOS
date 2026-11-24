import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import { isSupabaseConfigured, supabase } from '../supabase';
import {
  AiChatMessage,
  AiChatMessageMetadata,
  AiConversation,
  ConversationLanguagePreference
} from './chatHistoryTypes';
import {
  createClientMessageId,
  DEFAULT_CONVERSATION_TITLE,
  formatMessagePreview,
  generateConversationTitleFromMessage,
  MAX_CHAT_MESSAGE_LENGTH,
  normalizeConversationLanguage,
  normalizeConversationTitle,
  sanitizeMessageMetadata,
  sortConversationsNewestFirst
} from './chatHistoryUtils';
import { AssistantActionType } from './transactionSchemas';
import { XosModuleKey } from './xosKnowledge';

interface DbConversationRow {
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

interface DbMessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'model';
  content: string;
  message_metadata: Record<string, unknown> | null;
  client_message_id: string;
  created_at: string;
}

const CONVERSATION_SELECT_COLUMNS =
  'id, user_id, title, pinned, archived, language_preference, last_message_preview, created_at, updated_at, last_message_at';

const MESSAGE_SELECT_COLUMNS =
  'id, conversation_id, user_id, role, content, message_metadata, client_message_id, created_at';

let activeSupabaseClient: SupabaseClient = supabase;
let configuredOverride: boolean | null = null;

// Session-only in-memory store used strictly when Supabase backend is not active (zero browser persistence)
const memoryConversations = new Map<string, AiConversation>();
const memoryMessages = new Map<string, AiChatMessage[]>();

export function configureChatHistoryClientForTests(
  clientOverride: SupabaseClient | null,
  backendActiveOverride: boolean | null
): void {
  activeSupabaseClient = clientOverride || supabase;
  configuredOverride = backendActiveOverride;
}

export function resetChatHistoryMemoryForTests(): void {
  memoryConversations.clear();
  memoryMessages.clear();
}

function isBackendActive(): boolean {
  return configuredOverride !== null ? configuredOverride : isSupabaseConfigured;
}

function mapConversationRow(row: DbConversationRow): AiConversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title || DEFAULT_CONVERSATION_TITLE,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    languagePreference: normalizeConversationLanguage(row.language_preference),
    lastMessagePreview: row.last_message_preview || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at || row.updated_at || row.created_at
  };
}

function mapMessageRow(row: DbMessageRow): AiChatMessage {
  const cleanMeta = sanitizeMessageMetadata(row.message_metadata as AiChatMessageMetadata | null);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    langHint: cleanMeta.langHint as 'ml' | 'en' | 'mixed' | undefined,
    modules: cleanMeta.modules as XosModuleKey[] | undefined,
    actionType: cleanMeta.actionType as AssistantActionType | undefined,
    clientMessageId: row.client_message_id,
    createdAt: row.created_at
  };
}

function generateLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function requireAuthenticatedUserId(): Promise<string> {
  const { data, error } = await activeSupabaseClient.auth.getSession();
  if (error) {
    throw new Error(sanitizeDatabaseErrorMessage(error, 'Your session has expired. Please sign in again.'));
  }
  const userId = data?.session?.user?.id;
  if (!userId) {
    throw new Error('Your session has expired. Please sign in again.');
  }
  return userId;
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code || '');
  const msg = String((err as { message?: unknown }).message || '').toLowerCase();
  return code === '23505' || msg.includes('duplicate key value');
}

export interface CreateConversationInput {
  title?: string;
  languagePreference?: ConversationLanguagePreference;
}

export interface SaveMessageInput {
  conversationId: string;
  role: 'user' | 'model';
  content: string;
  clientMessageId?: string;
  metadata?: AiChatMessageMetadata;
}

export interface SaveMessageResult {
  message: AiChatMessage;
  conversation: AiConversation;
}

export const chatHistoryService = {
  async listConversations(): Promise<AiConversation[]> {
    if (!isBackendActive()) {
      return sortConversationsNewestFirst(Array.from(memoryConversations.values()));
    }

    const userId = await requireAuthenticatedUserId();
    const { data, error } = await activeSupabaseClient
      .from('ai_conversations')
      .select(CONVERSATION_SELECT_COLUMNS)
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false });

    if (error) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not load conversations. Please try again.'));
    }

    return sortConversationsNewestFirst(((data as DbConversationRow[] | null) || []).map(mapConversationRow));
  },

  async createConversation(input: CreateConversationInput = {}): Promise<AiConversation> {
    const cleanTitle = normalizeConversationTitle(input.title || '') || DEFAULT_CONVERSATION_TITLE;
    const languagePreference = normalizeConversationLanguage(input.languagePreference);

    if (!isBackendActive()) {
      const nowIso = new Date().toISOString();
      const conv: AiConversation = {
        id: generateLocalId('conv'),
        userId: 'local-session',
        title: cleanTitle,
        pinned: false,
        archived: false,
        languagePreference,
        lastMessagePreview: '',
        createdAt: nowIso,
        updatedAt: nowIso,
        lastMessageAt: nowIso
      };
      memoryConversations.set(conv.id, conv);
      memoryMessages.set(conv.id, []);
      return conv;
    }

    const userId = await requireAuthenticatedUserId();
    const nowIso = new Date().toISOString();
    const { data, error } = await activeSupabaseClient
      .from('ai_conversations')
      .insert({
        user_id: userId,
        title: cleanTitle,
        pinned: false,
        archived: false,
        language_preference: languagePreference,
        last_message_preview: '',
        created_at: nowIso,
        updated_at: nowIso,
        last_message_at: nowIso
      })
      .select(CONVERSATION_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not start a new conversation. Please try again.'));
    }

    return mapConversationRow(data as DbConversationRow);
  },

  async getMessages(conversationId: string): Promise<AiChatMessage[]> {
    if (!conversationId) {
      throw new Error('Conversation ID is required.');
    }

    if (!isBackendActive()) {
      if (!memoryConversations.has(conversationId)) {
        throw new Error('Conversation not found.');
      }
      return [...(memoryMessages.get(conversationId) || [])];
    }

    const userId = await requireAuthenticatedUserId();
    const { data: convData, error: convError } = await activeSupabaseClient
      .from('ai_conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (convError) {
      throw new Error(sanitizeDatabaseErrorMessage(convError, 'Could not load conversation messages.'));
    }
    if (!convData) {
      throw new Error('Conversation not found.');
    }

    const { data, error } = await activeSupabaseClient
      .from('ai_messages')
      .select(MESSAGE_SELECT_COLUMNS)
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not load messages for this conversation.'));
    }

    return ((data as DbMessageRow[] | null) || []).map(mapMessageRow);
  },

  async saveMessage(input: SaveMessageInput): Promise<SaveMessageResult> {
    const trimmedContent = input.content.trim();
    if (!trimmedContent) {
      throw new Error('Cannot save an empty message.');
    }
    const boundedContent = trimmedContent.slice(0, MAX_CHAT_MESSAGE_LENGTH);
    const clientMessageId = (input.clientMessageId || createClientMessageId()).trim();
    const cleanMetadata = sanitizeMessageMetadata(input.metadata);
    const preview = formatMessagePreview(boundedContent);

    if (!isBackendActive()) {
      const conv = memoryConversations.get(input.conversationId);
      if (!conv) {
        throw new Error('Conversation not found.');
      }
      const existingList = memoryMessages.get(input.conversationId) || [];
      const duplicate = existingList.find(m => m.clientMessageId === clientMessageId);
      if (duplicate) {
        return { message: duplicate, conversation: conv };
      }

      const nowIso = new Date().toISOString();
      const message: AiChatMessage = {
        id: generateLocalId('msg'),
        conversationId: conv.id,
        userId: conv.userId,
        role: input.role,
        content: boundedContent,
        langHint: cleanMetadata.langHint as 'ml' | 'en' | 'mixed' | undefined,
        modules: cleanMetadata.modules as XosModuleKey[] | undefined,
        actionType: cleanMetadata.actionType as AssistantActionType | undefined,
        clientMessageId,
        createdAt: nowIso
      };
      memoryMessages.set(conv.id, [...existingList, message]);

      const nextTitle =
        conv.title === DEFAULT_CONVERSATION_TITLE && input.role === 'user'
          ? generateConversationTitleFromMessage(boundedContent)
          : conv.title;
      const updatedConv: AiConversation = {
        ...conv,
        title: nextTitle,
        lastMessagePreview: preview,
        updatedAt: nowIso,
        lastMessageAt: nowIso
      };
      memoryConversations.set(conv.id, updatedConv);
      return { message, conversation: updatedConv };
    }

    const userId = await requireAuthenticatedUserId();

    const { data: convRow, error: convLookupError } = await activeSupabaseClient
      .from('ai_conversations')
      .select(CONVERSATION_SELECT_COLUMNS)
      .eq('id', input.conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (convLookupError) {
      throw new Error(sanitizeDatabaseErrorMessage(convLookupError, 'Could not verify conversation ownership.'));
    }
    if (!convRow) {
      throw new Error('Conversation not found.');
    }

    const parentConv = mapConversationRow(convRow as DbConversationRow);

    // Check existing client_message_id first for clean idempotency
    const { data: existingRow, error: existingLookupError } = await activeSupabaseClient
      .from('ai_messages')
      .select(MESSAGE_SELECT_COLUMNS)
      .eq('conversation_id', input.conversationId)
      .eq('user_id', userId)
      .eq('client_message_id', clientMessageId)
      .maybeSingle();

    if (existingLookupError) {
      throw new Error(sanitizeDatabaseErrorMessage(existingLookupError, 'Could not check message delivery state.'));
    }
    if (existingRow) {
      return {
        message: mapMessageRow(existingRow as DbMessageRow),
        conversation: parentConv
      };
    }

    const nowIso = new Date().toISOString();
    const { data: insertedRow, error: insertError } = await activeSupabaseClient
      .from('ai_messages')
      .insert({
        conversation_id: input.conversationId,
        user_id: userId,
        role: input.role,
        content: boundedContent,
        message_metadata: cleanMetadata,
        client_message_id: clientMessageId,
        created_at: nowIso
      })
      .select(MESSAGE_SELECT_COLUMNS)
      .single();

    let savedRow: DbMessageRow | null = insertedRow as DbMessageRow | null;
    if (insertError) {
      if (isUniqueConstraintError(insertError)) {
        const { data: conflictRow, error: conflictFetchError } = await activeSupabaseClient
          .from('ai_messages')
          .select(MESSAGE_SELECT_COLUMNS)
          .eq('conversation_id', input.conversationId)
          .eq('user_id', userId)
          .eq('client_message_id', clientMessageId)
          .maybeSingle();
        if (conflictFetchError || !conflictRow) {
          throw new Error(sanitizeDatabaseErrorMessage(insertError, 'Could not save message.'));
        }
        savedRow = conflictRow as DbMessageRow;
      } else {
        throw new Error(sanitizeDatabaseErrorMessage(insertError, 'Could not save message to conversation history.'));
      }
    }

    if (!savedRow) {
      throw new Error('Could not confirm message save.');
    }

    const nextTitle =
      parentConv.title === DEFAULT_CONVERSATION_TITLE && input.role === 'user'
        ? generateConversationTitleFromMessage(boundedContent)
        : parentConv.title;

    const { data: updatedConvRow, error: updateConvError } = await activeSupabaseClient
      .from('ai_conversations')
      .update({
        title: nextTitle,
        last_message_preview: preview,
        last_message_at: savedRow.created_at || nowIso,
        updated_at: nowIso
      })
      .eq('id', input.conversationId)
      .eq('user_id', userId)
      .select(CONVERSATION_SELECT_COLUMNS)
      .single();

    if (updateConvError || !updatedConvRow) {
      // Message row itself persisted; construct accurate conversation snapshot if metadata update had transient race
      return {
        message: mapMessageRow(savedRow),
        conversation: {
          ...parentConv,
          title: nextTitle,
          lastMessagePreview: preview,
          lastMessageAt: savedRow.created_at || nowIso,
          updatedAt: nowIso
        }
      };
    }

    return {
      message: mapMessageRow(savedRow),
      conversation: mapConversationRow(updatedConvRow as DbConversationRow)
    };
  },

  async updateConversationTitle(conversationId: string, rawTitle: string): Promise<AiConversation> {
    const cleanTitle = normalizeConversationTitle(rawTitle);
    if (!cleanTitle) {
      throw new Error('Conversation title cannot be empty.');
    }

    if (!isBackendActive()) {
      const existing = memoryConversations.get(conversationId);
      if (!existing) throw new Error('Conversation not found.');
      const updated: AiConversation = {
        ...existing,
        title: cleanTitle,
        updatedAt: new Date().toISOString()
      };
      memoryConversations.set(conversationId, updated);
      return updated;
    }

    const userId = await requireAuthenticatedUserId();
    const { data, error } = await activeSupabaseClient
      .from('ai_conversations')
      .update({
        title: cleanTitle,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select(CONVERSATION_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not rename conversation.'));
    }
    return mapConversationRow(data as DbConversationRow);
  },

  async updateConversationLanguage(
    conversationId: string,
    languagePreference: ConversationLanguagePreference
  ): Promise<AiConversation> {
    const normalizedLang = normalizeConversationLanguage(languagePreference);

    if (!isBackendActive()) {
      const existing = memoryConversations.get(conversationId);
      if (!existing) throw new Error('Conversation not found.');
      const updated: AiConversation = {
        ...existing,
        languagePreference: normalizedLang,
        updatedAt: new Date().toISOString()
      };
      memoryConversations.set(conversationId, updated);
      return updated;
    }

    const userId = await requireAuthenticatedUserId();
    const { data, error } = await activeSupabaseClient
      .from('ai_conversations')
      .update({
        language_preference: normalizedLang,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select(CONVERSATION_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not update conversation language preference.'));
    }
    return mapConversationRow(data as DbConversationRow);
  },

  async setConversationPinned(conversationId: string, pinned: boolean): Promise<AiConversation> {
    if (!isBackendActive()) {
      const existing = memoryConversations.get(conversationId);
      if (!existing) throw new Error('Conversation not found.');
      const updated: AiConversation = {
        ...existing,
        pinned: Boolean(pinned),
        updatedAt: new Date().toISOString()
      };
      memoryConversations.set(conversationId, updated);
      return updated;
    }

    const userId = await requireAuthenticatedUserId();
    const { data, error } = await activeSupabaseClient
      .from('ai_conversations')
      .update({
        pinned: Boolean(pinned),
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select(CONVERSATION_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not update pinned status.'));
    }
    return mapConversationRow(data as DbConversationRow);
  },

  async setConversationArchived(conversationId: string, archived: boolean): Promise<AiConversation> {
    if (!isBackendActive()) {
      const existing = memoryConversations.get(conversationId);
      if (!existing) throw new Error('Conversation not found.');
      const updated: AiConversation = {
        ...existing,
        archived: Boolean(archived),
        updatedAt: new Date().toISOString()
      };
      memoryConversations.set(conversationId, updated);
      return updated;
    }

    const userId = await requireAuthenticatedUserId();
    const { data, error } = await activeSupabaseClient
      .from('ai_conversations')
      .update({
        archived: Boolean(archived),
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select(CONVERSATION_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not update archive status.'));
    }
    return mapConversationRow(data as DbConversationRow);
  },

  async deleteConversation(conversationId: string): Promise<void> {
    if (!conversationId) {
      throw new Error('Conversation ID is required.');
    }

    if (!isBackendActive()) {
      if (!memoryConversations.has(conversationId)) {
        throw new Error('Conversation not found.');
      }
      memoryMessages.delete(conversationId);
      memoryConversations.delete(conversationId);
      return;
    }

    const userId = await requireAuthenticatedUserId();

    const { error: msgDeleteError } = await activeSupabaseClient
      .from('ai_messages')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    if (msgDeleteError) {
      throw new Error(sanitizeDatabaseErrorMessage(msgDeleteError, 'Could not delete conversation messages.'));
    }

    const { data: deletedRows, error: convDeleteError } = await activeSupabaseClient
      .from('ai_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select('id');

    if (convDeleteError) {
      throw new Error(sanitizeDatabaseErrorMessage(convDeleteError, 'Could not delete conversation.'));
    }

    if (!deletedRows || deletedRows.length === 0) {
      throw new Error('Conversation could not be deleted or was not found.');
    }
  }
};
