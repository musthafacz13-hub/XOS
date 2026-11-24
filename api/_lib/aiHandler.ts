import { XOS_SYSTEM_SPECIFICATION } from '../../src/services/ai/xosKnowledge.js';
import {
  AssistantActionType,
  ClarificationResult,
  detectExplicitInvalidDateInText,
  EntryCatalog,
  EntryCatalogSchema,
  hasPotentialTransactionIntent,
  isExplicitReadOnlyQuestion,
  isUnsupportedDeleteOrEditRequest,
  parseMalayalamManglishAmount,
  parseStructuredLlmJson,
  PendingTransactionProposal,
  validateAndNormalizeProposal
} from '../../src/services/ai/transactionSchemas.js';
import {
  AiErrorCategory,
  AiRequestStage,
  ASSISTANT_FALLBACK_MODEL,
  ASSISTANT_MODEL,
  classifyGeminiError,
  createGeminiClient,
  getGeminiApiKey,
  getThinkingConfigForModel,
  TRANSCRIBE_MODEL,
  TTS_MODEL
} from './gemini.js';
import {
  callGroqChatCompletion,
  callGroqTranscription,
  getGroqApiKey,
  GROQ_MAX_COMPLETION_TOKENS,
  GROQ_PRIMARY_MODEL,
  GROQ_TEMPERATURE,
  GROQ_TRANSCRIBE_MODEL,
  GroqApiError,
  isFallbackEligibleCategory
} from './groq.js';

export interface ConversationHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export interface AssistantRequestPayload {
  message: string;
  history?: ConversationHistoryTurn[];
  groundedContext?: Record<string, unknown>;
  entryCatalog?: EntryCatalog;
  preferredLanguage?: 'auto' | 'ml-IN' | 'en-IN';
}

export interface TranscribeRequestPayload {
  audioBase64: string;
  mimeType: string;
  preferredLanguage?: 'auto' | 'ml-IN' | 'en-IN';
}

export interface SpeakRequestPayload {
  text: string;
  languageHint?: 'ml' | 'en' | 'mixed';
}

export interface HandlerResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface GeminiClientLike {
  models: {
    generateContent: (params: Record<string, unknown>) => Promise<{
      text?: string;
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            thought?: boolean;
            inlineData?: { data?: string; mimeType?: string };
          }>;
        };
      }>;
    }>;
  };
}

export interface AiHandlerDeps {
  fetchImpl?: typeof fetch;
  groqFetchImpl?: typeof fetch;
  createClient?: (apiKey: string, timeoutMs: number) => GeminiClientLike;
  assistantTimeoutMs?: number;
  transcribeTimeoutMs?: number;
  speakTimeoutMs?: number;
  authTimeoutMs?: number;
}

const MAX_MESSAGE_CHARS = 1800;
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_TURN_CHARS = 1000;
const GROQ_MAX_CONTEXT_JSON_CHARS = 12000;
const MAX_CONTEXT_JSON_CHARS = 28000;
// Keep under Vercel's 4.5MB serverless request body limit
const MAX_AUDIO_BASE64_CHARS = 3.2 * 1024 * 1024;
const MAX_SPEAK_CHARS = 1800;

export const DEFAULT_AUTH_TIMEOUT_MS = 6000;
export const DEFAULT_ASSISTANT_GEMINI_TIMEOUT_MS = 42000;
export const DEFAULT_TRANSCRIBE_GEMINI_TIMEOUT_MS = 42000;
export const DEFAULT_SPEAK_GEMINI_TIMEOUT_MS = 32000;

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/x-flac'
]);

function createRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getSupabaseServerConfig(): { url: string; anonKey: string } | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  if (url.includes('your-project-ref') || anonKey.includes('your-anon-public-key')) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { url: parsed.origin, anonKey };
  } catch {
    return null;
  }
}

export function extractBearerToken(authHeader?: string | string[]): string | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw || typeof raw !== 'string') return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(raw.trim());
  return match ? match[1] : null;
}

export interface AuthVerificationResult {
  valid: boolean;
  userId?: string;
  reason?: string;
  timedOut?: boolean;
  authDurationMs: number;
}

export async function verifySupabaseSessionToken(
  authHeader?: string | string[],
  fetchImpl: typeof fetch = fetch,
  authTimeoutMs: number = DEFAULT_AUTH_TIMEOUT_MS
): Promise<AuthVerificationResult> {
  const startedAt = Date.now();
  const supabaseCfg = getSupabaseServerConfig();
  if (!supabaseCfg) {
    return {
      valid: true,
      userId: 'local-workspace',
      authDurationMs: Date.now() - startedAt
    };
  }

  const token = extractBearerToken(authHeader);
  if (!token) {
    return {
      valid: false,
      reason: 'Your session has expired. Please sign in again.',
      authDurationMs: Date.now() - startedAt
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, authTimeoutMs);

  try {
    const response = await fetchImpl(`${supabaseCfg.url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: supabaseCfg.anonKey,
        Authorization: `Bearer ${token}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        valid: false,
        reason: 'Your session has expired. Please sign in again.',
        authDurationMs: Date.now() - startedAt
      };
    }

    const userJson = (await response.json()) as { id?: string };
    if (!userJson?.id) {
      return {
        valid: false,
        reason: 'Your session has expired. Please sign in again.',
        authDurationMs: Date.now() - startedAt
      };
    }

    return {
      valid: true,
      userId: userJson.id,
      authDurationMs: Date.now() - startedAt
    };
  } catch {
    return {
      valid: false,
      timedOut,
      reason: timedOut
        ? 'AI is taking longer than expected. Please try again.'
        : 'Unable to verify your session right now. Please try again.',
      authDurationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

const MANGLISH_RESPONSE_REGEX =
  /\b(innu|innale|rupa|paisa|chelav\w*|chilav\w*|kadam|koduthu|vaangi|kitti|varavu|varumanam|shambalam|sambalam|cheyyu|cherkk\w*|adichu|ethra|aanu|undo|undu|masam|maasam)\b/i;

export function detectResponseLanguage(text: string): 'ml' | 'en' | 'mixed' {
  const hasMalayalamScript = /[\u0D00-\u0D7F]/.test(text);
  const hasLatin = /[A-Za-z]{2,}/.test(text);
  if (hasMalayalamScript && hasLatin) return 'mixed';
  if (hasMalayalamScript) return 'ml';
  if (MANGLISH_RESPONSE_REGEX.test(text)) return 'mixed';
  return 'en';
}

function extractGeminiResponseText(
  resp:
    | {
        text?: string;
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              thought?: boolean;
            }>;
          };
        }>;
      }
    | null
    | undefined
): string {
  if (!resp) return '';
  if (typeof resp.text === 'string' && resp.text.trim()) {
    return resp.text.trim();
  }
  const parts = resp.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const joined = parts
      .filter(p => !p?.thought && typeof p?.text === 'string')
      .map(p => p.text!.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  return '';
}

function getServerIstTodayString(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const year = parts.find(p => p.type === 'year')?.value || '2026';
  const month = parts.find(p => p.type === 'month')?.value || '01';
  const day = parts.find(p => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function buildDefaultEntryCatalog(): EntryCatalog {
  return {
    currency: 'INR',
    todayIst: getServerIstTodayString(),
    expenseCategories: [
      'Food & Dining',
      'Housing',
      'Utilities',
      'Transport',
      'Entertainment',
      'Shopping',
      'Health & Fitness',
      'Education',
      'Debt & Bills',
      'Subscriptions',
      'Other'
    ],
    incomeSources: ['Salary', 'Freelance', 'Business', 'Gifts', 'Investments', 'Other'],
    activeDebts: [],
    activeSavingsGoals: []
  };
}

function resolveEntryCatalog(rawCatalog: unknown): EntryCatalog {
  const parsed = EntryCatalogSchema.safeParse(rawCatalog);
  if (parsed.success) {
    return parsed.data;
  }
  return buildDefaultEntryCatalog();
}

function buildVoiceEntrySystemInstructions(catalog: EntryCatalog): string {
  const catalogJson = JSON.stringify({
    todayIst: catalog.todayIst,
    currency: catalog.currency,
    expenseCategories: catalog.expenseCategories,
    incomeSources: catalog.incomeSources,
    activeDebts: catalog.activeDebts.slice(0, 20),
    activeSavingsGoals: catalog.activeSavingsGoals.slice(0, 20)
  });

  return `VOICE-TO-DATA PREPARATION PROTOCOL (NEVER WRITE TO DB DIRECTLY):
You are preparing a structured transaction preview for explicit user confirmation. You NEVER write to the database yourself.

CATALOG & TODAY (IST):
${catalogJson}

ALLOWED ACTIONS (respond with ONE valid JSON object and NO extra prose outside JSON):
1) If the user is asking a read-only question, summary, or calculation (NOT adding a new transaction):
{"action":"read_only_query","reply":"<concise natural answer grounded in context>"}

2) If the user asks to delete, edit, update, or reset existing records:
{"action":"unsupported_mutation","reply":"<politely explain voice assistant only prepares new entries and guide them to edit/delete in the relevant XOS module>"}

3) If the user wants to record a NEW transaction, pick the exact matching intent and return:
{"action":"transaction_proposal","confidence":0.95,"reply":"<short confirmation question in user's language>","transaction":{...}}
Supported transaction shapes:
- create_expense: {"intent":"create_expense","amount":150,"category":"<must be from expenseCategories>","title":"<short description>","date":"YYYY-MM-DD","paymentMethod":"Cash|Credit Card|Debit Card|Bank Transfer|Digital Wallet","notes":"optional"}
- create_income: {"intent":"create_income","amount":5000,"source":"<must be from incomeSources>","title":"<short description>","date":"YYYY-MM-DD","notes":"optional"}
- create_debt_receivable ("Money to Receive" - user gave/lent money): {"intent":"create_debt_receivable","direction":"receive","personName":"<name>","amount":1000,"date":"YYYY-MM-DD","dueDate":"optional YYYY-MM-DD","description":"optional"}
- create_debt_payable ("Money to Pay" - user borrowed/owes money): {"intent":"create_debt_payable","direction":"pay","personName":"<name>","amount":2000,"date":"YYYY-MM-DD","dueDate":"optional YYYY-MM-DD","description":"optional"}
- record_debt_repayment (repaying/collecting existing debt ONLY): {"intent":"record_debt_repayment","debtId":"<matching id from activeDebts if known>","personName":"<name>","direction":"pay|receive","amount":500,"date":"YYYY-MM-DD","paymentMethod":"Bank Transfer|Cash|Digital Wallet|Credit Card|Debit Card","notes":"optional"}
- create_savings_transaction: {"intent":"create_savings_transaction","savingsGoalId":"<matching id from activeSavingsGoals if known>","savingsGoalName":"<goal name>","transactionType":"deposit|withdrawal","amount":1000,"date":"YYYY-MM-DD","note":"optional"}

4) If amount is vague ("some money", "കുറച്ചു പണം"), <= 0, date is invalid, category/source/savings goal is unclear, multiple matching debts exist, or confidence < 0.7:
{"action":"clarification_needed","reason":"ambiguous_amount|invalid_amount|invalid_date|unclear_category|unclear_source|unclear_person|multiple_debts|debt_not_found|unclear_savings_goal|low_confidence|missing_details","reply":"<concise clarification question in user's language>","transaction":{}}

MALAYALAM / MANGLISH / ENGLISH RULES:
- Dates: "ഇന്ന്"/"innu"/"today" -> ${catalog.todayIst}; "ഇന്നലെ"/"innale"/"yesterday" -> 1 day before ${catalog.todayIst}.
- Debt direction MUST NEVER be swapped: "കടം കൊടുത്തു"/"കിട്ടാനുണ്ട്"/"lent"/"owes me" => create_debt_receivable; "കടം വാങ്ങി"/"കൊടുക്കാനുണ്ട്"/"തരാനുണ്ട്"/"borrowed"/"I owe" => create_debt_payable; "തിരിച്ചു കൊടുത്തു"/"തിരിച്ചു തന്നു"/"repaid"/"paid back" => record_debt_repayment.
- NEVER invent categories or savingsGoalIds not in CATALOG.`;
}

function sanitizeTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/₹\s*/g, 'rupees ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COMPACTION_ARRAY_KEYS = [
  'recentAllTimeTransactions',
  'recentAllTimeEntries',
  'recentTransactions',
  'recentEntries',
  'recentRecords',
  'recentRepayments',
  'recentPayouts',
  'debts',
  'items',
  'activeReserves',
  'byCategory',
  'bySource'
] as const;

function clonePlainJsonValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function markContextCompacted(ctx: Record<string, unknown>): void {
  const workspace =
    ctx.workspace && typeof ctx.workspace === 'object' && !Array.isArray(ctx.workspace)
      ? ({ ...(ctx.workspace as Record<string, unknown>) })
      : {};
  workspace.contextCompacted = true;
  ctx.workspace = workspace;
}

function trimNestedArraysInContext(ctx: Record<string, unknown>, maxArrayLen: number): void {
  for (const [modKey, modVal] of Object.entries(ctx)) {
    if (modKey === 'workspace' || !modVal || typeof modVal !== 'object' || Array.isArray(modVal)) {
      continue;
    }
    const modObj = { ...(modVal as Record<string, unknown>) };
    for (const arrKey of COMPACTION_ARRAY_KEYS) {
      const candidate = modObj[arrKey];
      if (Array.isArray(candidate) && candidate.length > maxArrayLen) {
        modObj[arrKey] = candidate.slice(0, maxArrayLen);
      }
    }
    if (modObj.allTime && typeof modObj.allTime === 'object' && !Array.isArray(modObj.allTime)) {
      const allTimeObj = { ...(modObj.allTime as Record<string, unknown>) };
      if (Array.isArray(allTimeObj.topCategories) && allTimeObj.topCategories.length > maxArrayLen) {
        allTimeObj.topCategories = allTimeObj.topCategories.slice(0, maxArrayLen);
      }
      modObj.allTime = allTimeObj;
    }
    ctx[modKey] = modObj;
  }
}

export function serializeGroundedContextSafely(
  rawContext: unknown,
  maxChars: number = MAX_CONTEXT_JSON_CHARS
): { json: string; compacted: boolean; modules: string[] } {
  if (!rawContext || typeof rawContext !== 'object' || Array.isArray(rawContext)) {
    return { json: '{}', compacted: false, modules: [] };
  }

  const base = clonePlainJsonValue(rawContext as Record<string, unknown>);
  const modules = Object.keys(base).filter(k => k !== 'workspace');

  let json = JSON.stringify(base);
  if (json.length <= maxChars) {
    return { json, compacted: false, modules };
  }

  // Progressively shrink detail arrays while always keeping valid JSON
  const arrayCaps = [8, 4, 2, 0];
  let working = clonePlainJsonValue(base);
  markContextCompacted(working);

  for (const cap of arrayCaps) {
    trimNestedArraysInContext(working, cap);
    json = JSON.stringify(working);
    if (json.length <= maxChars) {
      return { json, compacted: true, modules };
    }
  }

  // Final structural fallback: keep workspace + scalar/nested summary metrics of each module
  const ultraCompact: Record<string, unknown> = {
    workspace: working.workspace
  };
  for (const [modKey, modVal] of Object.entries(working)) {
    if (modKey === 'workspace' || !modVal || typeof modVal !== 'object' || Array.isArray(modVal)) {
      continue;
    }
    const summaryOnly: Record<string, unknown> = {};
    for (const [fieldKey, fieldVal] of Object.entries(modVal as Record<string, unknown>)) {
      if (!Array.isArray(fieldVal)) {
        summaryOnly[fieldKey] = fieldVal;
      }
    }
    ultraCompact[modKey] = summaryOnly;
  }

  json = JSON.stringify(ultraCompact);
  if (json.length <= maxChars) {
    return { json, compacted: true, modules };
  }

  // Last-resort valid JSON summary if still oversized
  return {
    json: JSON.stringify({
      workspace: {
        contextCompacted: true,
        selectedModules: modules
      }
    }),
    compacted: true,
    modules
  };
}

function logDiagnostic(
  level: 'info' | 'warn' | 'error',
  fields: {
    event: string;
    requestId: string;
    endpoint: string;
    stage: AiRequestStage;
    provider?: 'groq' | 'gemini';
    fallbackUsed?: boolean;
    authDurationMs?: number;
    geminiDurationMs?: number;
    providerDurationMs?: number;
    totalDurationMs: number;
    model?: string;
    status: number;
    errorCategory?: AiErrorCategory;
    geminiErrorCode?: string;
    providerErrorCode?: string;
    timeoutStage?: 'auth' | 'groq' | 'gemini' | null;
    contextModules?: string[];
    contextChars?: number;
  }
): void {
  const payload = JSON.stringify(fields);
  if (level === 'error') {
    console.error(payload);
  } else if (level === 'warn') {
    console.warn(payload);
  } else {
    console.log(payload);
  }
}

function buildErrorBody(params: {
  error: string;
  category: AiErrorCategory;
  stage: AiRequestStage;
  requestId: string;
  durationMs: number;
  provider?: 'groq' | 'gemini';
  model?: string;
  timeoutStage?: 'auth' | 'groq' | 'gemini' | null;
}): Record<string, unknown> {
  return {
    error: params.error,
    code: params.category,
    category: params.category,
    stage: params.stage,
    requestId: params.requestId,
    durationMs: params.durationMs,
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.timeoutStage ? { timeoutStage: params.timeoutStage } : {})
  };
}

export async function handleAssistantRequest(
  payload: unknown,
  authHeader?: string | string[],
  deps: AiHandlerDeps = {}
): Promise<HandlerResponse> {
  const startTime = Date.now();
  const requestId = createRequestId();
  const endpoint = '/api/ai/assistant';
  const authTimeoutMs = deps.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const geminiTimeoutMs = deps.assistantTimeoutMs ?? DEFAULT_ASSISTANT_GEMINI_TIMEOUT_MS;

  const authCheck = await verifySupabaseSessionToken(authHeader, deps.fetchImpl, authTimeoutMs);
  if (!authCheck.valid) {
    const totalDurationMs = Date.now() - startTime;
    const category: AiErrorCategory = authCheck.timedOut ? 'timeout' : 'auth_required';
    const status = authCheck.timedOut ? 504 : 401;
    logDiagnostic('error', {
      event: 'ai_request_failed',
      requestId,
      endpoint,
      stage: 'auth',
      authDurationMs: authCheck.authDurationMs,
      totalDurationMs,
      status,
      errorCategory: category,
      timeoutStage: authCheck.timedOut ? 'auth' : null
    });
    return {
      status,
      body: buildErrorBody({
        error: authCheck.reason || 'Unauthorized',
        category,
        stage: 'auth',
        requestId,
        durationMs: totalDurationMs,
        timeoutStage: authCheck.timedOut ? 'auth' : null
      })
    };
  }

  const groqApiKey = getGroqApiKey();
  const geminiApiKey = getGeminiApiKey();

  if (!groqApiKey && !geminiApiKey) {
    const totalDurationMs = Date.now() - startTime;
    logDiagnostic('error', {
      event: 'ai_request_failed',
      requestId,
      endpoint,
      stage: 'config',
      authDurationMs: authCheck.authDurationMs,
      totalDurationMs,
      status: 503,
      errorCategory: 'invalid_api_key',
      providerErrorCode: 'MISSING_AI_API_KEYS'
    });
    return {
      status: 503,
      body: buildErrorBody({
        error: 'AI service is temporarily unavailable.',
        category: 'invalid_api_key',
        stage: 'config',
        requestId,
        durationMs: totalDurationMs
      })
    };
  }

  if (!payload || typeof payload !== 'object') {
    const totalDurationMs = Date.now() - startTime;
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Invalid request payload.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: totalDurationMs
      })
    };
  }

  const body = payload as Partial<AssistantRequestPayload>;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    const totalDurationMs = Date.now() - startTime;
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Message cannot be empty.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: totalDurationMs
      })
    };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    const totalDurationMs = Date.now() - startTime;
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Message is too long. Please keep questions concise.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: totalDurationMs
      })
    };
  }

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const sanitizedHistory: ConversationHistoryTurn[] = rawHistory
    .slice(-MAX_HISTORY_TURNS)
    .filter(
      (turn): turn is ConversationHistoryTurn =>
        Boolean(turn) &&
        (turn.role === 'user' || turn.role === 'model') &&
        typeof turn.text === 'string' &&
        turn.text.trim().length > 0
    )
    .map(turn => ({
      role: turn.role,
      text: turn.text.trim().slice(0, MAX_HISTORY_TURN_CHARS)
    }));

  const resolvedCatalog = resolveEntryCatalog(body.entryCatalog);
  const queryIsExplicitReadOnly = isExplicitReadOnlyQuestion(message);
  const queryIsUnsupportedMutation = !queryIsExplicitReadOnly && isUnsupportedDeleteOrEditRequest(message);
  const queryHasTransactionIntent = !queryIsExplicitReadOnly && !queryIsUnsupportedMutation && hasPotentialTransactionIntent(message);
  const detectedMsgLang = detectResponseLanguage(message);

  // Fast, zero-hallucination safety block for unsupported DB delete/edit requests
  if (queryIsUnsupportedMutation) {
    const totalDurationMs = Date.now() - startTime;
    const isMl = detectedMsgLang === 'ml' || body.preferredLanguage === 'ml-IN';
    const reply = isMl
      ? 'വോയ്‌സ് അസിസ്റ്റന്റ് വഴി പുതിയ ഇടപാടുകൾ ചേർക്കാൻ തയ്യാറാക്കാൻ മാത്രമേ കഴിയൂ. നിലവിലുള്ള രേഖകൾ മാറ്റാനോ ഡിലീറ്റ് ചെയ്യാനോ ദയവായി ബന്ധപ്പെട്ട XOS വിഭാഗം ഉപയോഗിക്കൂ.'
      : 'I can only help prepare new transactions for confirmation. To edit or delete existing records, please open the corresponding XOS module.';
    return {
      status: 200,
      body: {
        reply,
        actionType: 'unsupported_mutation' as AssistantActionType,
        pendingTransaction: null,
        clarification: null,
        detectedLanguage: detectResponseLanguage(reply),
        provider: 'groq',
        fallbackUsed: false,
        model: GROQ_PRIMARY_MODEL,
        requestId,
        durationMs: totalDurationMs
      }
    };
  }

  // Deterministic pre-validation for obvious invalid calendar dates or non-positive amounts on transaction entries
  if (queryHasTransactionIntent) {
    const invalidDateText = detectExplicitInvalidDateInText(message);
    if (invalidDateText) {
      const totalDurationMs = Date.now() - startTime;
      const isMl = detectedMsgLang === 'ml' || body.preferredLanguage === 'ml-IN';
      const msg = isMl
        ? `"${invalidDateText}" സാധുവായ കലണ്ടർ തീയതിയല്ല. ദയവായി ശരിയായ തീയതി നൽകാമോ?`
        : `"${invalidDateText}" is not a valid calendar date. Please provide a valid date.`;
      const clarification: ClarificationResult = { reason: 'invalid_date', message: msg };
      return {
        status: 200,
        body: {
          reply: msg,
          actionType: 'clarification_needed' as AssistantActionType,
          pendingTransaction: null,
          clarification,
          detectedLanguage: detectResponseLanguage(msg),
          provider: 'groq',
          fallbackUsed: false,
          model: GROQ_PRIMARY_MODEL,
          requestId,
          durationMs: totalDurationMs
        }
      };
    }

    const parsedAmt = parseMalayalamManglishAmount(message);
    if (parsedAmt.explicitNonPositive) {
      const totalDurationMs = Date.now() - startTime;
      const isMl = detectedMsgLang === 'ml' || body.preferredLanguage === 'ml-IN';
      const msg = isMl
        ? 'തുക പൂജ്യത്തേക്കാൾ കൂടുതൽ ആയിരിക്കണം. ദയവായി ശരിയായ തുക പറയാമോ?'
        : 'The transaction amount must be greater than zero. Please provide a valid positive amount.';
      const clarification: ClarificationResult = { reason: 'invalid_amount', message: msg };
      return {
        status: 200,
        body: {
          reply: msg,
          actionType: 'clarification_needed' as AssistantActionType,
          pendingTransaction: null,
          clarification,
          detectedLanguage: detectResponseLanguage(msg),
          provider: 'groq',
          fallbackUsed: false,
          model: GROQ_PRIMARY_MODEL,
          requestId,
          durationMs: totalDurationMs
        }
      };
    }
  }

  const groqContextResult = serializeGroundedContextSafely(body.groundedContext, GROQ_MAX_CONTEXT_JSON_CHARS);
  const geminiContextResult = serializeGroundedContextSafely(body.groundedContext, MAX_CONTEXT_JSON_CHARS);
  let activeContextResult = groqApiKey ? groqContextResult : geminiContextResult;

  const languageDirective =
    body.preferredLanguage === 'ml-IN'
      ? 'User prefers Malayalam (respond in natural Malayalam unless user explicitly asks in English).'
      : body.preferredLanguage === 'en-IN'
        ? 'User prefers English (understand and respond in Malayalam if user speaks/writes Malayalam).'
        : 'Auto-detect language from user message: natural Malayalam for Malayalam/Manglish, crisp English for English.';

  const systemInstruction = queryHasTransactionIntent
    ? `${XOS_SYSTEM_SPECIFICATION}

LANGUAGE:
${languageDirective}

${buildVoiceEntrySystemInstructions(resolvedCatalog)}`
    : `${XOS_SYSTEM_SPECIFICATION}

LANGUAGE:
${languageDirective}`;

  const groqTurnPrompt = `User Question:
${message}

XOS GROUNDED DATA CONTEXT (READ-ONLY JSON):
${groqContextResult.json}`;

  const geminiTurnPrompt = `User Question:
${message}

XOS GROUNDED DATA CONTEXT (READ-ONLY JSON):
${geminiContextResult.json}`;

  const buildGroqMessages = () => [
    { role: 'system' as const, content: systemInstruction },
    ...sanitizedHistory.map(turn => ({
      role: turn.role === 'model' ? ('assistant' as const) : ('user' as const),
      content: turn.text
    })),
    { role: 'user' as const, content: groqTurnPrompt }
  ];

  const geminiContents = [
    ...sanitizedHistory.map(turn => ({
      role: turn.role,
      parts: [{ text: turn.text }]
    })),
    {
      role: 'user' as const,
      parts: [{ text: geminiTurnPrompt }]
    }
  ];

  const clientFactory = deps.createClient ?? ((k: string, t: number) => createGeminiClient(k, t));
  const groqFetchFn = deps.groqFetchImpl ?? deps.fetchImpl;
  let activeProvider: 'groq' | 'gemini' = groqApiKey ? 'groq' : 'gemini';
  let activeModel = groqApiKey ? GROQ_PRIMARY_MODEL : ASSISTANT_MODEL;
  let fallbackUsed = !groqApiKey;

  const providerStart = Date.now();
  const serverController = new AbortController();
  let deadlineExceeded = false;
  const serverTimeoutId = setTimeout(() => {
    deadlineExceeded = true;
    serverController.abort();
  }, geminiTimeoutMs);

  const runGeminiFallback = async () => {
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
    }
    activeProvider = 'gemini';
    activeModel = ASSISTANT_MODEL;
    fallbackUsed = true;
    activeContextResult = geminiContextResult;

    const invokeGemini = async (modelName: string) => {
      const remainingMs = Math.max(2000, geminiTimeoutMs - (Date.now() - providerStart));
      const ai = clientFactory(geminiApiKey, remainingMs);
      const thinkingConfig = getThinkingConfigForModel(modelName);
      return ai.models.generateContent({
        model: modelName,
        contents: geminiContents,
        config: {
          systemInstruction,
          abortSignal: serverController.signal,
          ...(queryHasTransactionIntent ? { responseMimeType: 'application/json' } : {}),
          ...(thinkingConfig ? { thinkingConfig } : {})
        }
      });
    };

    try {
      const resp = await invokeGemini(activeModel);
      return extractGeminiResponseText(resp);
    } catch (primaryGeminiErr) {
      const primaryClassified = classifyGeminiError(
        primaryGeminiErr,
        deadlineExceeded || serverController.signal.aborted
      );
      const remainingMs = geminiTimeoutMs - (Date.now() - providerStart);
      if (
        primaryClassified.category === 'model_unavailable' &&
        !deadlineExceeded &&
        !serverController.signal.aborted &&
        remainingMs > 5000
      ) {
        activeModel = ASSISTANT_FALLBACK_MODEL;
        const resp = await invokeGemini(activeModel);
        return extractGeminiResponseText(resp);
      }
      throw primaryGeminiErr;
    }
  };

  try {
    let reply = '';
    if (groqApiKey) {
      try {
        const groqResult = await callGroqChatCompletion({
          apiKey: groqApiKey,
          messages: buildGroqMessages(),
          abortSignal: serverController.signal,
          fetchImpl: groqFetchFn,
          model: GROQ_PRIMARY_MODEL,
          maxCompletionTokens: GROQ_MAX_COMPLETION_TOKENS,
          temperature: GROQ_TEMPERATURE,
          reasoningEffort: 'low',
          ...(queryHasTransactionIntent ? { responseFormat: 'json_object' as const } : {})
        });
        reply = groqResult.reply;

        const remainingMsAfterGroq = geminiTimeoutMs - (Date.now() - providerStart);
        const reasoningTruncatedEmpty = groqResult.finishReason === 'length' && !reply;
        const nonJsonTransactionReply =
          queryHasTransactionIntent && Boolean(reply) && !parseStructuredLlmJson(reply);

        if (
          (reasoningTruncatedEmpty || nonJsonTransactionReply) &&
          geminiApiKey &&
          !deadlineExceeded &&
          !serverController.signal.aborted &&
          remainingMsAfterGroq > 6000
        ) {
          logDiagnostic('warn', {
            event: 'ai_provider_fallback',
            requestId,
            endpoint,
            stage: 'groq',
            provider: 'groq',
            fallbackUsed: true,
            authDurationMs: authCheck.authDurationMs,
            providerDurationMs: Date.now() - providerStart,
            totalDurationMs: Date.now() - startTime,
            model: GROQ_PRIMARY_MODEL,
            status: 502,
            errorCategory: 'invalid_response',
            providerErrorCode: reasoningTruncatedEmpty
              ? 'GROQ_REASONING_TRUNCATED'
              : 'GROQ_NON_JSON_TRANSACTION'
          });
          reply = await runGeminiFallback();
        }
      } catch (groqErr) {
        const groqClassified =
          groqErr instanceof GroqApiError
            ? groqErr.classified
            : classifyGeminiError(groqErr, deadlineExceeded || serverController.signal.aborted);

        const remainingMs = geminiTimeoutMs - (Date.now() - providerStart);
        const canRetryGroqWithoutJsonMode =
          groqClassified.geminiErrorCode === 'GROQ_JSON_VALIDATE_FAILED' &&
          !geminiApiKey &&
          !deadlineExceeded &&
          !serverController.signal.aborted &&
          remainingMs > 6000;

        if (canRetryGroqWithoutJsonMode) {
          const retryResult = await callGroqChatCompletion({
            apiKey: groqApiKey,
            messages: buildGroqMessages(),
            abortSignal: serverController.signal,
            fetchImpl: groqFetchFn,
            model: GROQ_PRIMARY_MODEL,
            maxCompletionTokens: GROQ_MAX_COMPLETION_TOKENS,
            temperature: GROQ_TEMPERATURE,
            reasoningEffort: 'low'
          });
          reply = retryResult.reply;
        } else {
          const canFallbackToGemini =
            Boolean(geminiApiKey) &&
            isFallbackEligibleCategory(groqClassified.category) &&
            !deadlineExceeded &&
            !serverController.signal.aborted &&
            remainingMs > 6000;

          if (canFallbackToGemini) {
            logDiagnostic('warn', {
              event: 'ai_provider_fallback',
              requestId,
              endpoint,
              stage: 'groq',
              provider: 'groq',
              fallbackUsed: true,
              authDurationMs: authCheck.authDurationMs,
              providerDurationMs: Date.now() - providerStart,
              totalDurationMs: Date.now() - startTime,
              model: GROQ_PRIMARY_MODEL,
              status: groqClassified.status,
              errorCategory: groqClassified.category,
              providerErrorCode: groqClassified.geminiErrorCode
            });
            reply = await runGeminiFallback();
          } else {
            throw groqErr;
          }
        }
      }
    } else {
      reply = await runGeminiFallback();
    }

    const providerDurationMs = Date.now() - providerStart;
    const totalDurationMs = Date.now() - startTime;

    if (!reply) {
      logDiagnostic('warn', {
        event: 'ai_request_empty',
        requestId,
        endpoint,
        stage: 'response',
        provider: activeProvider,
        fallbackUsed,
        authDurationMs: authCheck.authDurationMs,
        providerDurationMs,
        totalDurationMs,
        model: activeModel,
        status: 502,
        errorCategory: 'invalid_response',
        providerErrorCode: 'EMPTY_RESPONSE',
        contextModules: activeContextResult.modules,
        contextChars: activeContextResult.json.length
      });
      return {
        status: 502,
        body: buildErrorBody({
          error: 'Received an unexpected response from the AI service. Please try again.',
          category: 'invalid_response',
          stage: 'response',
          provider: activeProvider,
          requestId,
          durationMs: totalDurationMs,
          model: activeModel
        })
      };
    }

    let finalReply = reply;
    let actionType: AssistantActionType = 'read_only_query';
    let pendingTransaction: PendingTransactionProposal | null = null;
    let clarification: ClarificationResult | null = null;

    if (!queryIsExplicitReadOnly) {
      const structured = parseStructuredLlmJson(reply);
      if (structured) {
        if (structured.action === 'read_only_query') {
          actionType = 'read_only_query';
          finalReply = structured.reply;
        } else if (structured.action === 'unsupported_mutation') {
          actionType = 'unsupported_mutation';
          finalReply = structured.reply;
        } else if (structured.action === 'transaction_proposal') {
          const validated = validateAndNormalizeProposal({
            candidate: structured.candidate,
            confidence: structured.confidence,
            catalog: resolvedCatalog,
            rawUserText: message,
            detectedLanguage: detectedMsgLang
          });
          if (validated.status === 'valid') {
            actionType = 'transaction_proposal';
            pendingTransaction = validated.proposal;
            finalReply = validated.proposal.summaryReply;
          } else {
            actionType = 'clarification_needed';
            clarification = validated.clarification;
            finalReply = validated.clarification.message;
          }
        } else if (structured.action === 'clarification_needed') {
          actionType = 'clarification_needed';
          // Check if candidate triggers deterministic disambiguation options (e.g., multiple matching debts or savings goals)
          if (structured.candidate && structured.candidate.intent) {
            const disambigAttempt = validateAndNormalizeProposal({
              candidate: structured.candidate,
              confidence: 0.9,
              catalog: resolvedCatalog,
              rawUserText: message,
              detectedLanguage: detectedMsgLang
            });
            if (disambigAttempt.status === 'clarification' && disambigAttempt.clarification.disambiguationOptions) {
              clarification = disambigAttempt.clarification;
              finalReply = disambigAttempt.clarification.message;
            } else {
              clarification = {
                reason: structured.reason || 'missing_details',
                message: structured.reply
              };
              finalReply = structured.reply;
            }
          } else {
            clarification = {
              reason: structured.reason || 'missing_details',
              message: structured.reply
            };
            finalReply = structured.reply;
          }
        }
      } else if (queryHasTransactionIntent) {
        actionType = 'clarification_needed';
        clarification = {
          reason: 'missing_details',
          message: finalReply
        };
      }
    }

    logDiagnostic('info', {
      event: 'ai_request_success',
      requestId,
      endpoint,
      stage: 'response',
      provider: activeProvider,
      fallbackUsed,
      authDurationMs: authCheck.authDurationMs,
      providerDurationMs,
      totalDurationMs,
      model: activeModel,
      status: 200,
      contextModules: activeContextResult.modules,
      contextChars: activeContextResult.json.length
    });

    return {
      status: 200,
      body: {
        reply: finalReply,
        actionType,
        pendingTransaction,
        clarification,
        detectedLanguage: detectResponseLanguage(finalReply),
        provider: activeProvider,
        fallbackUsed,
        model: activeModel,
        requestId,
        durationMs: totalDurationMs
      }
    };
  } catch (err: unknown) {
    const providerDurationMs = Date.now() - providerStart;
    const totalDurationMs = Date.now() - startTime;
    const classified =
      err instanceof GroqApiError
        ? err.classified
        : classifyGeminiError(err, deadlineExceeded || serverController.signal.aborted);

    logDiagnostic('error', {
      event: 'ai_request_failed',
      requestId,
      endpoint,
      stage: activeProvider,
      provider: activeProvider,
      fallbackUsed,
      authDurationMs: authCheck.authDurationMs,
      providerDurationMs,
      totalDurationMs,
      model: activeModel,
      status: classified.status,
      errorCategory: classified.category,
      providerErrorCode: classified.geminiErrorCode,
      timeoutStage: classified.category === 'timeout' ? activeProvider : null,
      contextModules: activeContextResult.modules,
      contextChars: activeContextResult.json.length
    });

    return {
      status: classified.status,
      body: buildErrorBody({
        error: classified.userMessage,
        category: classified.category,
        stage: activeProvider,
        provider: activeProvider,
        requestId,
        durationMs: totalDurationMs,
        model: activeModel,
        timeoutStage: classified.category === 'timeout' ? activeProvider : null
      })
    };
  } finally {
    clearTimeout(serverTimeoutId);
  }
}

export async function handleTranscribeRequest(
  payload: unknown,
  authHeader?: string | string[],
  deps: AiHandlerDeps = {}
): Promise<HandlerResponse> {
  const startTime = Date.now();
  const requestId = createRequestId();
  const endpoint = '/api/ai/transcribe';
  const authTimeoutMs = deps.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const geminiTimeoutMs = deps.transcribeTimeoutMs ?? DEFAULT_TRANSCRIBE_GEMINI_TIMEOUT_MS;

  const authCheck = await verifySupabaseSessionToken(authHeader, deps.fetchImpl, authTimeoutMs);
  if (!authCheck.valid) {
    const totalDurationMs = Date.now() - startTime;
    const category: AiErrorCategory = authCheck.timedOut ? 'timeout' : 'auth_required';
    const status = authCheck.timedOut ? 504 : 401;
    return {
      status,
      body: buildErrorBody({
        error: authCheck.reason || 'Unauthorized',
        category,
        stage: 'auth',
        requestId,
        durationMs: totalDurationMs,
        timeoutStage: authCheck.timedOut ? 'auth' : null
      })
    };
  }

  const groqApiKey = getGroqApiKey();
  const geminiApiKey = getGeminiApiKey();
  if (!groqApiKey && !geminiApiKey) {
    const totalDurationMs = Date.now() - startTime;
    return {
      status: 503,
      body: buildErrorBody({
        error: 'AI service is temporarily unavailable.',
        category: 'invalid_api_key',
        stage: 'config',
        requestId,
        durationMs: totalDurationMs
      })
    };
  }

  if (!payload || typeof payload !== 'object') {
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Invalid audio payload.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: Date.now() - startTime
      })
    };
  }

  const body = payload as Partial<TranscribeRequestPayload>;
  const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';
  const mimeTypeRaw = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : 'audio/webm';
  const baseMime = mimeTypeRaw.split(';')[0].trim();
  const preferredLanguage: 'auto' | 'ml-IN' | 'en-IN' =
    body.preferredLanguage === 'en-IN' || body.preferredLanguage === 'auto' ? body.preferredLanguage : 'ml-IN';

  if (!audioBase64) {
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Audio recording is empty.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: Date.now() - startTime
      })
    };
  }
  if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Audio clip is too large. Keep voice queries concise.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: Date.now() - startTime
      })
    };
  }
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeTypeRaw) && !ALLOWED_AUDIO_MIME_TYPES.has(baseMime)) {
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Unsupported audio format.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: Date.now() - startTime
      })
    };
  }

  let decodedByteLength = 0;
  try {
    decodedByteLength = Buffer.from(audioBase64, 'base64').byteLength;
  } catch {
    decodedByteLength = 0;
  }
  if (decodedByteLength < 64) {
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Audio recording is invalid or too short.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: Date.now() - startTime
      })
    };
  }

  const langHint =
    preferredLanguage === 'ml-IN'
      ? 'The speaker is likely speaking Malayalam or Manglish (preserve Malayalam words in Malayalam script or Manglish, and keep English finance words like expense, income, debt, savings, salary as spoken; never translate into English or unrelated languages).'
      : preferredLanguage === 'en-IN'
        ? 'The speaker is likely speaking Indian English (or Malayalam-English finance terms). Transcribe strictly in English/Malayalam; never output unrelated languages like Spanish or French.'
        : 'The speaker is speaking Malayalam, Manglish, or Indian English. Preserve spoken Malayalam/Manglish/English accurately; never output unrelated languages like Spanish or French.';

  const clientFactory = deps.createClient ?? ((k: string, t: number) => createGeminiClient(k, t));
  const groqFetchFn = deps.groqFetchImpl ?? deps.fetchImpl;
  const geminiStart = Date.now();
  const serverController = new AbortController();
  let deadlineExceeded = false;
  const serverTimeoutId = setTimeout(() => {
    deadlineExceeded = true;
    serverController.abort();
  }, geminiTimeoutMs);

  let activeProvider: 'groq' | 'gemini' = groqApiKey ? 'groq' : 'gemini';
  let activeModel = groqApiKey ? GROQ_TRANSCRIBE_MODEL : TRANSCRIBE_MODEL;
  let fallbackUsed = false;

  const geminiAudioMime =
    baseMime === 'audio/x-wav'
      ? 'audio/wav'
      : baseMime === 'audio/x-m4a' || baseMime === 'audio/m4a'
        ? 'audio/mp4'
        : baseMime;

  const invokeGeminiTranscribe = async (gKey: string) => {
    activeProvider = 'gemini';
    activeModel = TRANSCRIBE_MODEL;
    const remainingMs = Math.max(2000, geminiTimeoutMs - (Date.now() - geminiStart));
    const ai = clientFactory(gKey, remainingMs);
    const response = await ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: geminiAudioMime,
              data: audioBase64
            }
          },
          {
            text: `Transcribe the spoken audio verbatim into text. ${langHint} Output ONLY the clean transcript text with no explanation, labels, or quotes. If there is only silence or noise, return an empty string.`
          }
        ]
      },
      config: {
        abortSignal: serverController.signal
      }
    });
    return extractGeminiResponseText(response);
  };

  try {
    let transcript = '';
    let detectedLanguage: string | undefined;
    let rejectionReason: 'no_speech' | 'unsupported_detected_language' | undefined;

    if (groqApiKey) {
      try {
        const res = await callGroqTranscription({
          apiKey: groqApiKey,
          audioBase64,
          mimeType: baseMime,
          preferredLanguage,
          abortSignal: serverController.signal,
          fetchImpl: groqFetchFn
        });
        transcript = res.transcript;
        detectedLanguage = res.detectedLanguage;
        rejectionReason = res.rejectionReason;
      } catch (groqErr) {
        const groqClassified =
          groqErr instanceof GroqApiError
            ? groqErr.classified
            : classifyGeminiError(groqErr, deadlineExceeded || serverController.signal.aborted);
        const remainingMs = geminiTimeoutMs - (Date.now() - geminiStart);
        if (
          geminiApiKey &&
          isFallbackEligibleCategory(groqClassified.category) &&
          !deadlineExceeded &&
          !serverController.signal.aborted &&
          remainingMs > 6000
        ) {
          fallbackUsed = true;
          transcript = await invokeGeminiTranscribe(geminiApiKey);
        } else {
          throw groqErr;
        }
      }
    } else if (geminiApiKey) {
      fallbackUsed = true;
      transcript = await invokeGeminiTranscribe(geminiApiKey);
    }

    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;

    if (rejectionReason === 'unsupported_detected_language') {
      logDiagnostic('warn', {
        event: 'ai_transcribe_language_rejected',
        requestId,
        endpoint,
        stage: 'response',
        provider: activeProvider,
        fallbackUsed,
        authDurationMs: authCheck.authDurationMs,
        providerDurationMs: geminiDurationMs,
        totalDurationMs,
        model: activeModel,
        status: 422,
        errorCategory: 'invalid_request'
      });
      return {
        status: 422,
        body: buildErrorBody({
          error: 'Could not recognize Malayalam or English speech clearly. Select Malayalam or English and try again.',
          category: 'invalid_request',
          stage: activeProvider,
          provider: activeProvider,
          requestId,
          durationMs: totalDurationMs,
          model: activeModel
        })
      };
    }

    logDiagnostic('info', {
      event: 'ai_transcribe_success',
      requestId,
      endpoint,
      stage: 'response',
      provider: activeProvider,
      fallbackUsed,
      authDurationMs: authCheck.authDurationMs,
      providerDurationMs: geminiDurationMs,
      totalDurationMs,
      model: activeModel,
      status: 200
    });

    return {
      status: 200,
      body: {
        transcript,
        provider: activeProvider,
        fallbackUsed,
        ...(detectedLanguage ? { detectedLanguage } : {}),
        requestId,
        model: activeModel,
        durationMs: totalDurationMs
      }
    };
  } catch (err: unknown) {
    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;
    const classified =
      err instanceof GroqApiError
        ? err.classified
        : classifyGeminiError(err, deadlineExceeded || serverController.signal.aborted);

    logDiagnostic('error', {
      event: 'ai_transcribe_failed',
      requestId,
      endpoint,
      stage: activeProvider,
      provider: activeProvider,
      fallbackUsed,
      authDurationMs: authCheck.authDurationMs,
      providerDurationMs: geminiDurationMs,
      totalDurationMs,
      model: activeModel,
      status: classified.status,
      errorCategory: classified.category,
      providerErrorCode: classified.geminiErrorCode,
      timeoutStage: classified.category === 'timeout' ? activeProvider : null
    });

    return {
      status: classified.status,
      body: buildErrorBody({
        error:
          classified.category === 'server_error'
            ? 'Could not transcribe voice recording. Please try speaking again or type.'
            : classified.userMessage,
        category: classified.category,
        stage: activeProvider,
        provider: activeProvider,
        requestId,
        durationMs: totalDurationMs,
        model: activeModel,
        timeoutStage: classified.category === 'timeout' ? activeProvider : null
      })
    };
  } finally {
    clearTimeout(serverTimeoutId);
  }
}

export async function handleSpeakRequest(
  payload: unknown,
  authHeader?: string | string[],
  deps: AiHandlerDeps = {}
): Promise<HandlerResponse> {
  const startTime = Date.now();
  const requestId = createRequestId();
  const endpoint = '/api/ai/speak';
  const authTimeoutMs = deps.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const geminiTimeoutMs = deps.speakTimeoutMs ?? DEFAULT_SPEAK_GEMINI_TIMEOUT_MS;

  const authCheck = await verifySupabaseSessionToken(authHeader, deps.fetchImpl, authTimeoutMs);
  if (!authCheck.valid) {
    const totalDurationMs = Date.now() - startTime;
    const category: AiErrorCategory = authCheck.timedOut ? 'timeout' : 'auth_required';
    const status = authCheck.timedOut ? 504 : 401;
    return {
      status,
      body: buildErrorBody({
        error: authCheck.reason || 'Unauthorized',
        category,
        stage: 'auth',
        requestId,
        durationMs: totalDurationMs,
        timeoutStage: authCheck.timedOut ? 'auth' : null
      })
    };
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const totalDurationMs = Date.now() - startTime;
    return {
      status: 503,
      body: buildErrorBody({
        error: 'AI service is temporarily unavailable.',
        category: 'invalid_api_key',
        stage: 'config',
        requestId,
        durationMs: totalDurationMs
      })
    };
  }

  if (!payload || typeof payload !== 'object') {
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Invalid speech request.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: Date.now() - startTime
      })
    };
  }

  const body = payload as Partial<SpeakRequestPayload>;
  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  const cleanSpeechText = sanitizeTextForSpeech(rawText).slice(0, MAX_SPEAK_CHARS);

  if (!cleanSpeechText) {
    return {
      status: 400,
      body: buildErrorBody({
        error: 'Speech text cannot be empty.',
        category: 'invalid_request',
        stage: 'validation',
        requestId,
        durationMs: Date.now() - startTime
      })
    };
  }

  const clientFactory = deps.createClient ?? ((k: string, t: number) => createGeminiClient(k, t));
  const geminiStart = Date.now();
  const serverController = new AbortController();
  let deadlineExceeded = false;
  const serverTimeoutId = setTimeout(() => {
    deadlineExceeded = true;
    serverController.abort();
  }, geminiTimeoutMs);

  try {
    const ai = clientFactory(apiKey, geminiTimeoutMs);
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: cleanSpeechText,
              speechMetadata: {
                style: 'Calm, composed, warm, articulate personal AI assistant speaking clearly and naturally'
              }
            }
          ]
        }
      ],
      config: {
        abortSignal: serverController.signal,
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Charon' }
          }
        }
      }
    });

    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;
    const inlineAudio = response.candidates?.[0]?.content?.parts?.find(
      p => Boolean(p?.inlineData?.data)
    )?.inlineData;
    const audioBase64 = inlineAudio?.data;

    if (!audioBase64) {
      logDiagnostic('warn', {
        event: 'ai_speak_empty',
        requestId,
        endpoint,
        stage: 'response',
        authDurationMs: authCheck.authDurationMs,
        geminiDurationMs,
        totalDurationMs,
        model: TTS_MODEL,
        status: 502,
        errorCategory: 'invalid_response',
        geminiErrorCode: 'EMPTY_AUDIO'
      });
      return {
        status: 502,
        body: buildErrorBody({
          error: 'Received an unexpected response from the AI service. Please try again.',
          category: 'invalid_response',
          stage: 'response',
          requestId,
          durationMs: totalDurationMs,
          model: TTS_MODEL
        })
      };
    }

    logDiagnostic('info', {
      event: 'ai_speak_success',
      requestId,
      endpoint,
      stage: 'response',
      authDurationMs: authCheck.authDurationMs,
      geminiDurationMs,
      totalDurationMs,
      model: TTS_MODEL,
      status: 200
    });

    return {
      status: 200,
      body: {
        audioBase64,
        mimeType: inlineAudio?.mimeType || 'audio/wav',
        requestId,
        model: TTS_MODEL,
        durationMs: totalDurationMs
      }
    };
  } catch (err: unknown) {
    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;
    const classified = classifyGeminiError(err, deadlineExceeded || serverController.signal.aborted);

    logDiagnostic('error', {
      event: 'ai_speak_failed',
      requestId,
      endpoint,
      stage: 'gemini',
      authDurationMs: authCheck.authDurationMs,
      geminiDurationMs,
      totalDurationMs,
      model: TTS_MODEL,
      status: classified.status,
      errorCategory: classified.category,
      geminiErrorCode: classified.geminiErrorCode,
      timeoutStage: classified.category === 'timeout' ? 'gemini' : null
    });

    return {
      status: classified.status,
      body: buildErrorBody({
        error: classified.userMessage,
        category: classified.category,
        stage: 'gemini',
        requestId,
        durationMs: totalDurationMs,
        model: TTS_MODEL,
        timeoutStage: classified.category === 'timeout' ? 'gemini' : null
      })
    };
  } finally {
    clearTimeout(serverTimeoutId);
  }
}
