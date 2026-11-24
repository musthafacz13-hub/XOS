import {
  AiChatMessageMetadata,
  AiConversation,
  ConversationDateBucket,
  ConversationGroup,
  ConversationLanguagePreference,
  OrganizedConversations
} from './chatHistoryTypes';
import { AssistantActionType } from './transactionSchemas';
import { XosModuleKey } from './xosKnowledge';

export const DEFAULT_CONVERSATION_TITLE = 'New Chat';
export const MAX_CONVERSATION_TITLE_LENGTH = 120;
export const MAX_CHAT_MESSAGE_LENGTH = 12000;

const VALID_LANGUAGES = new Set<ConversationLanguagePreference>(['auto', 'ml-IN', 'en-IN']);

export function normalizeConversationLanguage(
  raw: unknown,
  fallback: ConversationLanguagePreference = 'ml-IN'
): ConversationLanguagePreference {
  if (typeof raw === 'string' && VALID_LANGUAGES.has(raw as ConversationLanguagePreference)) {
    return raw as ConversationLanguagePreference;
  }
  return fallback;
}

export function generateConversationTitleFromMessage(rawMessage: string): string {
  const cleaned = rawMessage
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?'"`]+|[\s.,!?'"`]+$/g, '')
    .trim();

  if (!cleaned) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  const maxLen = 48;
  if (cleaned.length <= maxLen) {
    return cleaned;
  }

  const slice = cleaned.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = lastSpace >= 18 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trim()}…`;
}

export function normalizeConversationTitle(rawTitle: string): string {
  const cleaned = rawTitle.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.slice(0, MAX_CONVERSATION_TITLE_LENGTH);
}

export function formatMessagePreview(rawContent: string): string {
  const collapsed = rawContent.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= 96) return collapsed;
  return `${collapsed.slice(0, 95).trimEnd()}…`;
}

function getIstCalendarParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return {
    year: Number(parts.find(p => p.type === 'year')?.value || '1970'),
    month: Number(parts.find(p => p.type === 'month')?.value || '1'),
    day: Number(parts.find(p => p.type === 'day')?.value || '1')
  };
}

function getIstDayEpoch(date: Date): number {
  const { year, month, day } = getIstCalendarParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function getConversationDateBucket(
  isoTimestamp: string,
  now: Date = new Date()
): ConversationDateBucket {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return 'Older';
  }
  const diffDays = getIstDayEpoch(now) - getIstDayEpoch(parsed);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Previous 7 days';
  return 'Older';
}

export function formatConversationTimestamp(
  isoTimestamp: string,
  now: Date = new Date()
): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const bucket = getConversationDateBucket(isoTimestamp, now);
  if (bucket === 'Today') {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(parsed);
  }
  if (bucket === 'Yesterday') {
    return 'Yesterday';
  }
  if (bucket === 'Previous 7 days') {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short'
    }).format(parsed);
  }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric'
  }).format(parsed);
}

function getConversationSortTimeMs(conv: AiConversation): number {
  const ts = Date.parse(conv.lastMessageAt || conv.updatedAt || conv.createdAt);
  return Number.isFinite(ts) ? ts : 0;
}

export function sortConversationsNewestFirst(list: AiConversation[]): AiConversation[] {
  return [...list].sort((a, b) => getConversationSortTimeMs(b) - getConversationSortTimeMs(a));
}

export function organizeConversations(
  conversations: AiConversation[],
  now: Date = new Date()
): OrganizedConversations {
  const sorted = sortConversationsNewestFirst(conversations);
  const pinned: AiConversation[] = [];
  const archived: AiConversation[] = [];
  const buckets = new Map<ConversationDateBucket, AiConversation[]>([
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Older', []]
  ]);

  for (const conv of sorted) {
    if (conv.archived) {
      archived.push(conv);
      continue;
    }
    if (conv.pinned) {
      pinned.push(conv);
      continue;
    }
    const bucket = getConversationDateBucket(conv.lastMessageAt || conv.updatedAt || conv.createdAt, now);
    buckets.get(bucket)!.push(conv);
  }

  const recentGroups: ConversationGroup[] = [];
  const orderedLabels: ConversationDateBucket[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];
  for (const label of orderedLabels) {
    const items = buckets.get(label) || [];
    if (items.length > 0) {
      recentGroups.push({ label, items });
    }
  }

  return { pinned, recentGroups, archived };
}

const VALID_LANG_HINTS = new Set(['ml', 'en', 'mixed']);
const VALID_ACTION_TYPES = new Set<AssistantActionType>([
  'read_only_query',
  'transaction_proposal',
  'clarification_needed',
  'unsupported_mutation'
]);

/**
 * Strips any unexpected fields so tokens, credentials, or raw payloads
 * can never accidentally leak into persisted message_metadata.
 */
export function sanitizeMessageMetadata(raw?: AiChatMessageMetadata | null): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const clean: Record<string, unknown> = {};
  if (typeof raw.langHint === 'string' && VALID_LANG_HINTS.has(raw.langHint)) {
    clean.langHint = raw.langHint;
  }
  if (Array.isArray(raw.modules)) {
    const filtered = raw.modules
      .filter((m): m is XosModuleKey => typeof m === 'string' && m.length > 0 && m.length <= 40)
      .slice(0, 12);
    if (filtered.length > 0) {
      clean.modules = filtered;
    }
  }
  if (typeof raw.actionType === 'string' && VALID_ACTION_TYPES.has(raw.actionType as AssistantActionType)) {
    clean.actionType = raw.actionType;
  }
  return clean;
}

export function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cmsg_${crypto.randomUUID()}`;
  }
  return `cmsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
