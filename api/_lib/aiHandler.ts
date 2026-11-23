import { XOS_SYSTEM_SPECIFICATION } from '../../src/services/ai/xosKnowledge.js';
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
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav'
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

export function detectResponseLanguage(text: string): 'ml' | 'en' | 'mixed' {
  const hasMalayalamScript = /[\u0D00-\u0D7F]/.test(text);
  const hasLatin = /[A-Za-z]{2,}/.test(text);
  if (hasMalayalamScript && hasLatin) return 'mixed';
  if (hasMalayalamScript) return 'ml';
  return 'en';
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

  if (!groqApiKey) {
    const totalDurationMs = Date.now() - startTime;
    logDiagnostic('error', {
      event: 'ai_request_failed',
      requestId,
      endpoint,
      stage: 'config',
      provider: 'groq',
      authDurationMs: authCheck.authDurationMs,
      totalDurationMs,
      status: 503,
      errorCategory: 'invalid_api_key',
      providerErrorCode: 'MISSING_GROQ_API_KEY'
    });
    return {
      status: 503,
      body: buildErrorBody({
        error: 'AI service is temporarily unavailable.',
        category: 'invalid_api_key',
        stage: 'config',
        provider: 'groq',
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

  const serializedContextResult = serializeGroundedContextSafely(body.groundedContext, MAX_CONTEXT_JSON_CHARS);

  const languageDirective =
    body.preferredLanguage === 'ml-IN'
      ? 'User prefers Malayalam (respond in natural Malayalam unless user explicitly asks in English).'
      : body.preferredLanguage === 'en-IN'
        ? 'User prefers English (understand and respond in Malayalam if user speaks/writes Malayalam).'
        : 'Auto-detect language from user message: natural Malayalam for Malayalam/Manglish, crisp English for English.';

  const systemInstruction = `${XOS_SYSTEM_SPECIFICATION}

LANGUAGE:
${languageDirective}`;

  const groundedTurnPrompt = `User Question:
${message}

XOS GROUNDED DATA CONTEXT (READ-ONLY JSON):
${serializedContextResult.json}`;

  const groqMessages = [
    { role: 'system' as const, content: systemInstruction },
    ...sanitizedHistory.map(turn => ({
      role: turn.role === 'model' ? ('assistant' as const) : ('user' as const),
      content: turn.text
    })),
    { role: 'user' as const, content: groundedTurnPrompt }
  ];

  const geminiContents = [
    ...sanitizedHistory.map(turn => ({
      role: turn.role,
      parts: [{ text: turn.text }]
    })),
    {
      role: 'user' as const,
      parts: [{ text: groundedTurnPrompt }]
    }
  ];

  const clientFactory = deps.createClient ?? ((k: string, t: number) => createGeminiClient(k, t));
  const groqFetchFn = deps.groqFetchImpl ?? deps.fetchImpl;
  let activeProvider: 'groq' | 'gemini' = 'groq';
  let activeModel = GROQ_PRIMARY_MODEL;
  let fallbackUsed = false;

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
          ...(thinkingConfig ? { thinkingConfig } : {})
        }
      });
    };

    try {
      const resp = await invokeGemini(activeModel);
      return (resp.text || '').trim();
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
        return (resp.text || '').trim();
      }
      throw primaryGeminiErr;
    }
  };

  try {
    let reply = '';
    try {
      const groqResult = await callGroqChatCompletion({
        apiKey: groqApiKey,
        messages: groqMessages,
        abortSignal: serverController.signal,
        fetchImpl: groqFetchFn,
        model: GROQ_PRIMARY_MODEL,
        maxCompletionTokens: GROQ_MAX_COMPLETION_TOKENS,
        temperature: GROQ_TEMPERATURE,
        reasoningEffort: 'low'
      });
      reply = groqResult.reply;
    } catch (groqErr) {
      const groqClassified =
        groqErr instanceof GroqApiError
          ? groqErr.classified
          : classifyGeminiError(groqErr, deadlineExceeded || serverController.signal.aborted);

      const remainingMs = geminiTimeoutMs - (Date.now() - providerStart);
      const canFallbackToGemini =
        Boolean(geminiApiKey) &&
        isFallbackEligibleCategory(groqClassified.category) &&
        !deadlineExceeded &&
        !serverController.signal.aborted &&
        remainingMs > 10000;

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
        contextModules: serializedContextResult.modules,
        contextChars: serializedContextResult.json.length
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
      contextModules: serializedContextResult.modules,
      contextChars: serializedContextResult.json.length
    });

    return {
      status: 200,
      body: {
        reply,
        detectedLanguage: detectResponseLanguage(reply),
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
      contextModules: serializedContextResult.modules,
      contextChars: serializedContextResult.json.length
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
        error: 'Audio clip is too large. Keep voice queries under 40 seconds.',
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

  const langHint =
    body.preferredLanguage === 'ml-IN'
      ? 'The speaker is likely speaking Malayalam (or Malayalam mixed with English finance terms).'
      : body.preferredLanguage === 'en-IN'
        ? 'The speaker is likely speaking English (Indian English) or mixed Malayalam-English.'
        : 'The speaker may be speaking English, Malayalam, or natural Malayalam-English code-mixed speech.';

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
              mimeType: baseMime,
              data: audioBase64
            }
          },
          {
            text: `Transcribe the spoken audio verbatim into text. ${langHint} Use Malayalam script for Malayalam words and English letters for English words. Output ONLY the clean transcript text with no explanation, labels, or quotes. If there is only silence or noise, return an empty string.`
          }
        ]
      },
      config: {
        abortSignal: serverController.signal
      }
    });
    return (response.text || '').trim();
  };

  try {
    let transcript = '';
    if (groqApiKey) {
      try {
        const res = await callGroqTranscription({
          apiKey: groqApiKey,
          audioBase64,
          mimeType: baseMime,
          preferredLanguage: body.preferredLanguage,
          abortSignal: serverController.signal,
          fetchImpl: groqFetchFn
        });
        transcript = res.transcript;
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
          remainingMs > 10000
        ) {
          fallbackUsed = true;
          transcript = await invokeGeminiTranscribe(geminiApiKey);
        } else {
          throw groqErr;
        }
      }
    } else if (geminiApiKey) {
      transcript = await invokeGeminiTranscribe(geminiApiKey);
    }

    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;

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
    const inlineAudio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
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
