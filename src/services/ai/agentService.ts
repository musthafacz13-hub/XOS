/**
 * XOS Personal AI Agent — Frontend Service Interface
 * Communicates strictly with backend /api/ai/* routes using authenticated user Bearer tokens.
 * Never embeds API keys or invokes any XOS repository write operations.
 */
import { supabase, isSupabaseConfigured } from '../supabase';
import { SessionTurnMemory } from './contextBuilder';

export type PreferredVoiceLanguage = 'auto' | 'ml-IN' | 'en-IN';

export type AiServiceErrorCode =
  | 'auth_required'
  | 'invalid_api_key'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'timeout'
  | 'model_unavailable'
  | 'invalid_request'
  | 'invalid_response'
  | 'server_error'
  | 'network_error'
  | 'cancelled';

export const FRONTEND_ASSISTANT_TIMEOUT_MS = 52000;
export const FRONTEND_TRANSCRIBE_TIMEOUT_MS = 52000;
export const FRONTEND_SPEAK_TIMEOUT_MS = 42000;

export interface AiServiceErrorDetails {
  code: AiServiceErrorCode;
  status?: number;
  requestId?: string;
  stage?: string;
  durationMs?: number;
  model?: string;
}

export class AiServiceError extends Error {
  code: AiServiceErrorCode;
  category: AiServiceErrorCode;
  status?: number;
  requestId?: string;
  stage?: string;
  durationMs?: number;
  model?: string;
  retryable: boolean;

  constructor(message: string, code: AiServiceErrorCode, details: Omit<AiServiceErrorDetails, 'code'> = {}) {
    super(message);
    this.name = 'AiServiceError';
    this.code = code;
    this.category = code;
    this.status = details.status;
    this.requestId = details.requestId;
    this.stage = details.stage;
    this.durationMs = details.durationMs;
    this.model = details.model;
    this.retryable =
      code === 'timeout' ||
      code === 'rate_limited' ||
      code === 'network_error' ||
      code === 'server_error' ||
      code === 'invalid_response' ||
      code === 'model_unavailable';
  }
}

export interface AssistantReplyResult {
  reply: string;
  detectedLanguage: 'ml' | 'en' | 'mixed';
  model?: string;
  requestId?: string;
  durationMs?: number;
}

export interface TranscribeResult {
  transcript: string;
  requestId?: string;
  model?: string;
  durationMs?: number;
}

export interface SpeakResult {
  audioBase64: string;
  mimeType: string;
  requestId?: string;
  model?: string;
  durationMs?: number;
}

export interface PostAiOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  externalSignal?: AbortSignal;
}

const VALID_CATEGORIES = new Set<AiServiceErrorCode>([
  'auth_required',
  'invalid_api_key',
  'rate_limited',
  'quota_exceeded',
  'timeout',
  'model_unavailable',
  'invalid_request',
  'invalid_response',
  'server_error',
  'network_error',
  'cancelled'
]);

function normalizeErrorCategory(rawCode: unknown, status: number): AiServiceErrorCode {
  if (typeof rawCode === 'string' && VALID_CATEGORIES.has(rawCode as AiServiceErrorCode)) {
    return rawCode as AiServiceErrorCode;
  }
  if (status === 401) return 'auth_required';
  if (status === 403) return 'invalid_api_key';
  if (status === 429) return 'rate_limited';
  if (status === 504 || status === 524 || status === 408) return 'timeout';
  if (status === 404) return 'model_unavailable';
  if (status === 400 || status === 413) return 'invalid_request';
  if (status === 503) return 'invalid_api_key';
  return 'server_error';
}

function getHumanReadableErrorMessage(category: AiServiceErrorCode, serverMessage?: unknown): string {
  switch (category) {
    case 'auth_required':
      return 'Your session has expired. Please sign in again.';
    case 'invalid_api_key':
    case 'quota_exceeded':
    case 'model_unavailable':
      return 'AI service is temporarily unavailable.';
    case 'rate_limited':
      return 'AI service is busy right now. Please wait a moment and try again.';
    case 'timeout':
      return 'AI is taking longer than expected. Please try again.';
    case 'invalid_response':
      return 'Received an unexpected response from the AI service. Please try again.';
    case 'invalid_request':
      return typeof serverMessage === 'string' && serverMessage.trim()
        ? serverMessage.trim()
        : 'Could not process that request. Please rephrase and try again.';
    case 'network_error':
      return typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'You appear to be offline. Reconnect and try again.'
        : 'Could not reach the AI service. Please try again.';
    case 'cancelled':
      return 'Request cancelled.';
    case 'server_error':
    default:
      return 'AI service is temporarily unavailable. Please try again.';
  }
}

function isJwtExpiringSoon(token: string, bufferSeconds: number = 30): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64Url = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=');
    const decoded =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(decoded) as { exp?: unknown };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp <= Math.floor(Date.now() / 1000) + bufferSeconds;
  } catch {
    return false;
  }
}

async function resolveBearerToken(explicitAccessToken?: string | null): Promise<string | null> {
  const candidate = explicitAccessToken?.trim() || null;
  if (!isSupabaseConfigured) {
    return candidate;
  }

  if (candidate && !isJwtExpiringSoon(candidate)) {
    return candidate;
  }

  try {
    const { data } = await supabase.auth.getSession();
    const sessionToken = data.session?.access_token || null;
    if (sessionToken && !isJwtExpiringSoon(sessionToken)) {
      return sessionToken;
    }

    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session?.access_token) {
      return refreshed.session.access_token;
    }
    return sessionToken || candidate;
  } catch {
    return candidate;
  }
}

async function refreshBearerTokenAfter401(currentToken: string | null): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const sessionToken = data.session?.access_token || null;
    if (sessionToken && sessionToken !== currentToken && !isJwtExpiringSoon(sessionToken, 5)) {
      return sessionToken;
    }
    const { data: refreshed } = await supabase.auth.refreshSession();
    const fresh = refreshed.session?.access_token || null;
    if (fresh && fresh !== currentToken) {
      return fresh;
    }
  } catch {
    // Ignore session refresh errors
  }
  return null;
}

export async function postAiEndpoint<T>(
  endpoint: string,
  body: Record<string, unknown>,
  accessToken?: string | null,
  options: PostAiOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? FRONTEND_ASSISTANT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  let token = await resolveBearerToken(accessToken);
  if (isSupabaseConfigured && !token) {
    throw new AiServiceError(
      'Your session has expired. Please sign in again.',
      'auth_required',
      { status: 401, stage: 'auth' }
    );
  }

  const executeAttempt = async (bearerToken: string | null): Promise<T> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    let cancelledExternally = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onExternalAbort = () => {
      cancelledExternally = true;
      controller.abort();
    };
    if (options.externalSignal) {
      if (options.externalSignal.aborted) {
        clearTimeout(timeoutId);
        throw new AiServiceError('Request cancelled.', 'cancelled', { stage: 'network' });
      }
      options.externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      };
      if (bearerToken) {
        headers.Authorization = `Bearer ${bearerToken}`;
      }

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const elapsedMs = Date.now() - startedAt;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();

      let rawText = '';
      try {
        rawText = await response.text();
      } catch {
        throw new AiServiceError(
          getHumanReadableErrorMessage('invalid_response'),
          'invalid_response',
          { status: response.status, stage: 'response', durationMs: elapsedMs }
        );
      }

      const trimmedText = rawText.trim();
      const looksLikeJson =
        contentType.includes('application/json') ||
        trimmedText.startsWith('{') ||
        trimmedText.startsWith('[');

      let data: Record<string, unknown> | null = null;
      if (looksLikeJson && trimmedText) {
        try {
          const parsed = JSON.parse(trimmedText) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = parsed as Record<string, unknown>;
          }
        } catch {
          data = null;
        }
      }

      if (!data) {
        if (response.status === 504 || response.status === 524 || response.status === 408) {
          throw new AiServiceError(
            getHumanReadableErrorMessage('timeout'),
            'timeout',
            { status: response.status, stage: 'vercel', durationMs: elapsedMs }
          );
        }
        if (response.status === 413) {
          throw new AiServiceError(
            'Your request is too large. Please shorten your message or voice clip.',
            'invalid_request',
            { status: 413, stage: 'vercel', durationMs: elapsedMs }
          );
        }
        if (response.status === 401) {
          throw new AiServiceError(
            getHumanReadableErrorMessage('auth_required'),
            'auth_required',
            { status: 401, stage: 'auth', durationMs: elapsedMs }
          );
        }
        if (response.status === 429) {
          throw new AiServiceError(
            getHumanReadableErrorMessage('rate_limited'),
            'rate_limited',
            { status: 429, stage: 'vercel', durationMs: elapsedMs }
          );
        }
        if (response.status >= 500 && response.status <= 599 && !trimmedText.startsWith('<')) {
          throw new AiServiceError(
            getHumanReadableErrorMessage('server_error'),
            'server_error',
            { status: response.status, stage: 'vercel', durationMs: elapsedMs }
          );
        }
        throw new AiServiceError(
          getHumanReadableErrorMessage('invalid_response'),
          'invalid_response',
          { status: response.status, stage: 'vercel', durationMs: elapsedMs }
        );
      }

      if (!response.ok) {
        const category = normalizeErrorCategory(data.category || data.code, response.status);
        const message = getHumanReadableErrorMessage(category, data.error);

        throw new AiServiceError(message, category, {
          status: response.status,
          requestId: typeof data.requestId === 'string' ? data.requestId : undefined,
          stage: typeof data.stage === 'string' ? data.stage : undefined,
          durationMs: typeof data.durationMs === 'number' ? data.durationMs : elapsedMs,
          model: typeof data.model === 'string' ? data.model : undefined
        });
      }

      return data as T;
    } catch (err) {
      if (err instanceof AiServiceError) {
        throw err;
      }
      const elapsedMs = Date.now() - startedAt;
      const errName = (err as { name?: string })?.name;
      if (cancelledExternally || options.externalSignal?.aborted) {
        throw new AiServiceError('Request cancelled.', 'cancelled', {
          stage: 'network',
          durationMs: elapsedMs
        });
      }
      if (timedOut || errName === 'AbortError' || errName === 'TimeoutError') {
        throw new AiServiceError(
          getHumanReadableErrorMessage('timeout'),
          'timeout',
          { stage: 'network', durationMs: elapsedMs }
        );
      }
      throw new AiServiceError(
        getHumanReadableErrorMessage('network_error'),
        'network_error',
        { stage: 'network', durationMs: elapsedMs }
      );
    } finally {
      clearTimeout(timeoutId);
      if (options.externalSignal) {
        options.externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  };

  try {
    return await executeAttempt(token);
  } catch (err) {
    if (err instanceof AiServiceError && err.code === 'auth_required' && err.status === 401) {
      const refreshedToken = await refreshBearerTokenAfter401(token);
      if (refreshedToken) {
        return await executeAttempt(refreshedToken);
      }
    }
    throw err;
  }
}

let inFlightAssistantPromise: Promise<AssistantReplyResult> | null = null;

export const agentService = {
  async sendMessage(params: {
    message: string;
    history: SessionTurnMemory[];
    groundedContext: Record<string, unknown>;
    preferredLanguage: PreferredVoiceLanguage;
    accessToken?: string | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<AssistantReplyResult> {
    if (inFlightAssistantPromise) {
      return inFlightAssistantPromise;
    }

    const requestPromise = (async () => {
      const data = await postAiEndpoint<AssistantReplyResult>(
        '/api/ai/assistant',
        {
          message: params.message,
          history: params.history.map(h => ({ role: h.role, text: h.text })),
          groundedContext: params.groundedContext,
          preferredLanguage: params.preferredLanguage
        },
        params.accessToken,
        {
          fetchImpl: params.fetchImpl,
          timeoutMs: params.timeoutMs ?? FRONTEND_ASSISTANT_TIMEOUT_MS,
          externalSignal: params.signal
        }
      );

      if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new AiServiceError(
          getHumanReadableErrorMessage('invalid_response'),
          'invalid_response',
          { status: 502, stage: 'response', requestId: data?.requestId }
        );
      }
      return data;
    })();

    inFlightAssistantPromise = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (inFlightAssistantPromise === requestPromise) {
        inFlightAssistantPromise = null;
      }
    }
  },

  async transcribeAudio(params: {
    audioBase64: string;
    mimeType: string;
    preferredLanguage: PreferredVoiceLanguage;
    accessToken?: string | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<TranscribeResult> {
    const data = await postAiEndpoint<TranscribeResult>(
      '/api/ai/transcribe',
      {
        audioBase64: params.audioBase64,
        mimeType: params.mimeType,
        preferredLanguage: params.preferredLanguage
      },
      params.accessToken,
      {
        fetchImpl: params.fetchImpl,
        timeoutMs: params.timeoutMs ?? FRONTEND_TRANSCRIBE_TIMEOUT_MS,
        externalSignal: params.signal
      }
    );

    if (!data || typeof data.transcript !== 'string') {
      throw new AiServiceError(
        getHumanReadableErrorMessage('invalid_response'),
        'invalid_response',
        { status: 502, stage: 'response', requestId: data?.requestId }
      );
    }
    return data;
  },

  async synthesizeSpeech(params: {
    text: string;
    languageHint?: 'ml' | 'en' | 'mixed';
    accessToken?: string | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<SpeakResult> {
    const data = await postAiEndpoint<SpeakResult>(
      '/api/ai/speak',
      {
        text: params.text,
        languageHint: params.languageHint
      },
      params.accessToken,
      {
        fetchImpl: params.fetchImpl,
        timeoutMs: params.timeoutMs ?? FRONTEND_SPEAK_TIMEOUT_MS,
        externalSignal: params.signal
      }
    );

    if (!data || typeof data.audioBase64 !== 'string' || !data.audioBase64.trim()) {
      throw new AiServiceError(
        getHumanReadableErrorMessage('invalid_response'),
        'invalid_response',
        { status: 502, stage: 'response', requestId: data?.requestId }
      );
    }
    return data;
  }
};
