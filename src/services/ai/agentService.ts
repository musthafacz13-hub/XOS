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
  | 'server_error'
  | 'network_error';

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
  'server_error',
  'network_error'
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

async function resolveBearerToken(explicitAccessToken?: string | null): Promise<string | null> {
  if (explicitAccessToken && explicitAccessToken.trim()) {
    return explicitAccessToken.trim();
  }
  if (!isSupabaseConfigured) {
    return null;
  }
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

async function refreshBearerTokenIfChanged(currentToken: string | null): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const fresh = data.session?.access_token || null;
    if (fresh && fresh !== currentToken) {
      return fresh;
    }
  } catch {
    // Ignore session lookup failures
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
      'Please sign in with an active XOS session to talk to the AI Agent.',
      'auth_required',
      { status: 401, stage: 'auth' }
    );
  }

  const executeAttempt = async (bearerToken: string | null): Promise<T> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onExternalAbort = () => controller.abort();
    if (options.externalSignal) {
      if (options.externalSignal.aborted) {
        clearTimeout(timeoutId);
        throw new AiServiceError('Request cancelled.', 'network_error', { stage: 'network' });
      }
      options.externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
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

      if (!contentType.includes('application/json')) {
        if (response.status === 504 || response.status === 524 || response.status === 408) {
          throw new AiServiceError(
            'The serverless AI function timed out before returning a response. Please try again.',
            'timeout',
            { status: response.status, stage: 'vercel', durationMs: elapsedMs }
          );
        }
        if (response.status === 413) {
          throw new AiServiceError(
            'The request payload exceeded the server limit. Try a shorter message or audio clip.',
            'invalid_request',
            { status: 413, stage: 'vercel', durationMs: elapsedMs }
          );
        }
        if (response.status === 404) {
          throw new AiServiceError(
            'AI API endpoint was not found in this deployment environment.',
            'server_error',
            { status: 404, stage: 'vercel', durationMs: elapsedMs }
          );
        }
        throw new AiServiceError(
          `AI backend returned an unexpected non-JSON response (HTTP ${response.status}).`,
          'server_error',
          { status: response.status, stage: 'vercel', durationMs: elapsedMs }
        );
      }

      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        throw new AiServiceError(
          'Received an invalid JSON response from the AI service.',
          'server_error',
          { status: response.status, stage: 'response', durationMs: elapsedMs }
        );
      }

      if (!response.ok) {
        const category = normalizeErrorCategory(data.category || data.code, response.status);
        const message =
          typeof data.error === 'string' && data.error.trim()
            ? data.error
            : 'Unable to complete AI request right now.';

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
      if (timedOut || errName === 'AbortError' || errName === 'TimeoutError') {
        throw new AiServiceError(
          'The AI service took too long to respond. Please try again.',
          'timeout',
          { stage: 'network', durationMs: elapsedMs }
        );
      }
      throw new AiServiceError(
        'Unable to connect to the AI service. Check your internet connection and try again.',
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
      const refreshedToken = await refreshBearerTokenIfChanged(token);
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
          timeoutMs: params.timeoutMs ?? FRONTEND_ASSISTANT_TIMEOUT_MS
        }
      );

      if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new AiServiceError(
          'AI returned an empty or invalid response. Please try again.',
          'server_error',
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
  }): Promise<TranscribeResult> {
    return postAiEndpoint<TranscribeResult>(
      '/api/ai/transcribe',
      {
        audioBase64: params.audioBase64,
        mimeType: params.mimeType,
        preferredLanguage: params.preferredLanguage
      },
      params.accessToken,
      {
        fetchImpl: params.fetchImpl,
        timeoutMs: params.timeoutMs ?? FRONTEND_TRANSCRIBE_TIMEOUT_MS
      }
    );
  },

  async synthesizeSpeech(params: {
    text: string;
    languageHint?: 'ml' | 'en' | 'mixed';
    accessToken?: string | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }): Promise<SpeakResult> {
    return postAiEndpoint<SpeakResult>(
      '/api/ai/speak',
      {
        text: params.text,
        languageHint: params.languageHint
      },
      params.accessToken,
      {
        fetchImpl: params.fetchImpl,
        timeoutMs: params.timeoutMs ?? FRONTEND_SPEAK_TIMEOUT_MS
      }
    );
  }
};
