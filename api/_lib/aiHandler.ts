import { XOS_SYSTEM_SPECIFICATION } from '../../src/services/ai/xosKnowledge.ts';
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
} from './gemini.ts';

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
  createClient?: (apiKey: string, timeoutMs: number) => GeminiClientLike;
  assistantTimeoutMs?: number;
  transcribeTimeoutMs?: number;
  speakTimeoutMs?: number;
  authTimeoutMs?: number;
}

const MAX_MESSAGE_CHARS = 1800;
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_TURN_CHARS = 1000;
const MAX_CONTEXT_JSON_CHARS = 14000;
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
      reason: 'Authentication required. Please sign in to use the AI Agent.',
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
        reason: 'Your session is invalid or expired. Please sign in again.',
        authDurationMs: Date.now() - startedAt
      };
    }

    const userJson = (await response.json()) as { id?: string };
    if (!userJson?.id) {
      return {
        valid: false,
        reason: 'Unable to verify authenticated user.',
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
        ? 'Session verification timed out. Please try again.'
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

function logDiagnostic(
  level: 'info' | 'warn' | 'error',
  fields: {
    event: string;
    requestId: string;
    endpoint: string;
    stage: AiRequestStage;
    authDurationMs?: number;
    geminiDurationMs?: number;
    totalDurationMs: number;
    model?: string;
    status: number;
    errorCategory?: AiErrorCategory;
    geminiErrorCode?: string;
    timeoutStage?: 'auth' | 'gemini' | null;
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
  model?: string;
  timeoutStage?: 'auth' | 'gemini' | null;
}): Record<string, unknown> {
  return {
    error: params.error,
    code: params.category,
    category: params.category,
    stage: params.stage,
    requestId: params.requestId,
    durationMs: params.durationMs,
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

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
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
      geminiErrorCode: 'MISSING_API_KEY'
    });
    return {
      status: 503,
      body: buildErrorBody({
        error: 'Gemini AI backend key is not configured on the server.',
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

  let serializedContext = '{}';
  if (body.groundedContext && typeof body.groundedContext === 'object') {
    const rawJson = JSON.stringify(body.groundedContext);
    serializedContext =
      rawJson.length > MAX_CONTEXT_JSON_CHARS
        ? rawJson.slice(0, MAX_CONTEXT_JSON_CHARS)
        : rawJson;
  }

  const languageDirective =
    body.preferredLanguage === 'ml-IN'
      ? 'User prefers Malayalam (respond in natural Malayalam unless user explicitly asks in English).'
      : body.preferredLanguage === 'en-IN'
        ? 'User prefers English (understand and respond in Malayalam if user speaks/writes Malayalam).'
        : 'Auto-detect language from user message: natural Malayalam for Malayalam/Manglish, crisp English for English.';

  const systemInstruction = `${XOS_SYSTEM_SPECIFICATION}

LANGUAGE:
${languageDirective}

XOS GROUNDED CONTEXT (READ-ONLY):
${serializedContext}`;

  const contents = [
    ...sanitizedHistory.map(turn => ({
      role: turn.role,
      parts: [{ text: turn.text }]
    })),
    {
      role: 'user' as const,
      parts: [{ text: message }]
    }
  ];

  const clientFactory = deps.createClient ?? ((k: string, t: number) => createGeminiClient(k, t));
  let activeModel = ASSISTANT_MODEL;
  const geminiStart = Date.now();
  const serverController = new AbortController();
  let deadlineExceeded = false;
  const serverTimeoutId = setTimeout(() => {
    deadlineExceeded = true;
    serverController.abort();
  }, geminiTimeoutMs);

  const runModel = async (modelName: string) => {
    const remainingMs = Math.max(2000, geminiTimeoutMs - (Date.now() - geminiStart));
    const ai = clientFactory(apiKey, remainingMs);
    const thinkingConfig = getThinkingConfigForModel(modelName);
    return ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction,
        abortSignal: serverController.signal,
        ...(thinkingConfig ? { thinkingConfig } : {})
      }
    });
  };

  try {
    let response;
    try {
      response = await runModel(activeModel);
    } catch (primaryErr) {
      const primaryClassified = classifyGeminiError(primaryErr, deadlineExceeded || serverController.signal.aborted);
      const remainingMs = geminiTimeoutMs - (Date.now() - geminiStart);
      if (
        primaryClassified.category === 'model_unavailable' &&
        !deadlineExceeded &&
        !serverController.signal.aborted &&
        remainingMs > 5000
      ) {
        activeModel = ASSISTANT_FALLBACK_MODEL;
        response = await runModel(activeModel);
      } else {
        throw primaryErr;
      }
    }

    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;
    const reply = (response.text || '').trim();

    if (!reply) {
      logDiagnostic('warn', {
        event: 'ai_request_empty',
        requestId,
        endpoint,
        stage: 'response',
        authDurationMs: authCheck.authDurationMs,
        geminiDurationMs,
        totalDurationMs,
        model: activeModel,
        status: 502,
        errorCategory: 'server_error',
        geminiErrorCode: 'EMPTY_RESPONSE'
      });
      return {
        status: 502,
        body: buildErrorBody({
          error: 'AI returned an empty response. Please try again.',
          category: 'server_error',
          stage: 'response',
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
      authDurationMs: authCheck.authDurationMs,
      geminiDurationMs,
      totalDurationMs,
      model: activeModel,
      status: 200
    });

    return {
      status: 200,
      body: {
        reply,
        detectedLanguage: detectResponseLanguage(reply),
        model: activeModel,
        requestId,
        durationMs: totalDurationMs
      }
    };
  } catch (err: unknown) {
    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;
    const classified = classifyGeminiError(err, deadlineExceeded || serverController.signal.aborted);

    logDiagnostic('error', {
      event: 'ai_request_failed',
      requestId,
      endpoint,
      stage: 'gemini',
      authDurationMs: authCheck.authDurationMs,
      geminiDurationMs,
      totalDurationMs,
      model: activeModel,
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
        model: activeModel,
        timeoutStage: classified.category === 'timeout' ? 'gemini' : null
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

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const totalDurationMs = Date.now() - startTime;
    return {
      status: 503,
      body: buildErrorBody({
        error: 'Gemini AI backend key is not configured for voice transcription.',
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

    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;
    const transcript = (response.text || '').trim();

    logDiagnostic('info', {
      event: 'ai_transcribe_success',
      requestId,
      endpoint,
      stage: 'response',
      authDurationMs: authCheck.authDurationMs,
      geminiDurationMs,
      totalDurationMs,
      model: TRANSCRIBE_MODEL,
      status: 200
    });

    return {
      status: 200,
      body: { transcript, requestId, model: TRANSCRIBE_MODEL, durationMs: totalDurationMs }
    };
  } catch (err: unknown) {
    const geminiDurationMs = Date.now() - geminiStart;
    const totalDurationMs = Date.now() - startTime;
    const classified = classifyGeminiError(err, deadlineExceeded || serverController.signal.aborted);

    logDiagnostic('error', {
      event: 'ai_transcribe_failed',
      requestId,
      endpoint,
      stage: 'gemini',
      authDurationMs: authCheck.authDurationMs,
      geminiDurationMs,
      totalDurationMs,
      model: TRANSCRIBE_MODEL,
      status: classified.status,
      errorCategory: classified.category,
      geminiErrorCode: classified.geminiErrorCode,
      timeoutStage: classified.category === 'timeout' ? 'gemini' : null
    });

    return {
      status: classified.status,
      body: buildErrorBody({
        error:
          classified.category === 'server_error'
            ? 'Could not transcribe voice recording. Please try speaking again or type.'
            : classified.userMessage,
        category: classified.category,
        stage: 'gemini',
        requestId,
        durationMs: totalDurationMs,
        model: TRANSCRIBE_MODEL,
        timeoutStage: classified.category === 'timeout' ? 'gemini' : null
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
        error: 'Gemini AI backend key is not configured for voice playback.',
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
        errorCategory: 'server_error',
        geminiErrorCode: 'EMPTY_AUDIO'
      });
      return {
        status: 502,
        body: buildErrorBody({
          error: 'Speech audio was not generated.',
          category: 'server_error',
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
