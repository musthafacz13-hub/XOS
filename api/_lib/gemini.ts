/**
 * XOS Personal AI Agent — Server-Side Gemini SDK Client & Error Classifier
 * Reads process.env.GEMINI_API_KEY exclusively on the server.
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export const ASSISTANT_MODEL = 'gemini-4-hydrogen';
export const ASSISTANT_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
export const TTS_MODEL = 'gemini-3.8-flash-lite-tts';

export type AiErrorCategory =
  | 'auth_required'
  | 'invalid_api_key'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'timeout'
  | 'model_unavailable'
  | 'invalid_request'
  | 'invalid_response'
  | 'server_error'
  | 'network_error';

export type AiRequestStage =
  | 'validation'
  | 'auth'
  | 'config'
  | 'gemini'
  | 'response'
  | 'vercel'
  | 'network';

export interface ClassifiedGeminiError {
  status: number;
  category: AiErrorCategory;
  geminiErrorCode: string;
  userMessage: string;
}

export function getGeminiApiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return trimmed;
}

/**
 * Creates a bounded @google/genai client.
 * - Sets explicit HTTP timeout on each request attempt.
 * - Disables multi-attempt SDK retries (attempts: 1) so exponential backoff loops
 *   cannot silently overrun the Vercel serverless execution window.
 * - Note: Per-request cancellation MUST be passed via `config.abortSignal`
 *   (HttpOptions does not accept `signal`).
 */
export function createGeminiClient(apiKey: string, timeoutMs: number): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: timeoutMs,
      retryOptions: {
        attempts: 1
      },
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

export function getThinkingConfigForModel(model: string): { thinkingLevel: ThinkingLevel } | undefined {
  if (model === ASSISTANT_MODEL) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  if (model === ASSISTANT_FALLBACK_MODEL) {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  return undefined;
}

export function classifyGeminiError(
  err: unknown,
  wasAbortedByServerDeadline: boolean
): ClassifiedGeminiError {
  const errObj = (err && typeof err === 'object' ? err : {}) as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
    message?: string;
    cause?: { code?: string; name?: string; message?: string };
  };

  const status = Number(errObj.status || errObj.statusCode || 0);
  const rawMessage = typeof errObj.message === 'string' ? errObj.message : String(err || '');
  const lowerMsg = rawMessage.toLowerCase();
  const causeCode = (errObj.cause?.code || errObj.code || '').toUpperCase();
  const errName = (errObj.name || '').toLowerCase();

  if (
    wasAbortedByServerDeadline ||
    errName === 'aborterror' ||
    errName === 'timeouterror' ||
    causeCode === 'ABORT_ERR' ||
    causeCode === 'UND_ERR_HEADERS_TIMEOUT' ||
    causeCode === 'UND_ERR_BODY_TIMEOUT' ||
    status === 504 ||
    lowerMsg.includes('aborted') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout')
  ) {
    return {
      status: 504,
      category: 'timeout',
      geminiErrorCode: causeCode || 'DEADLINE_EXCEEDED',
      userMessage: 'AI is taking longer than expected. Please try again.'
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    lowerMsg.includes('api_key_invalid') ||
    lowerMsg.includes('api key not valid') ||
    lowerMsg.includes('permission_denied') ||
    lowerMsg.includes('invalid api key')
  ) {
    return {
      status: 502,
      category: 'invalid_api_key',
      geminiErrorCode: status === 403 ? 'PERMISSION_DENIED' : 'API_KEY_INVALID',
      userMessage: 'AI service is temporarily unavailable.'
    };
  }

  if (
    status === 404 ||
    lowerMsg.includes('not_found') ||
    (lowerMsg.includes('model') && (lowerMsg.includes('not found') || lowerMsg.includes('not supported')))
  ) {
    return {
      status: 502,
      category: 'model_unavailable',
      geminiErrorCode: 'MODEL_NOT_FOUND',
      userMessage: 'AI service is temporarily unavailable.'
    };
  }

  if (status === 429 || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('too many requests')) {
    const isQuotaExhausted =
      lowerMsg.includes('quota') ||
      lowerMsg.includes('billing') ||
      lowerMsg.includes('limit: 0') ||
      lowerMsg.includes('exceeded your current quota');

    if (isQuotaExhausted) {
      return {
        status: 429,
        category: 'quota_exceeded',
        geminiErrorCode: 'QUOTA_EXCEEDED',
        userMessage: 'AI service is temporarily unavailable.'
      };
    }

    return {
      status: 429,
      category: 'rate_limited',
      geminiErrorCode: 'RESOURCE_EXHAUSTED',
      userMessage: 'AI service is busy right now. Please wait a moment and try again.'
    };
  }

  if (status === 400 || lowerMsg.includes('invalid_argument')) {
    return {
      status: 400,
      category: 'invalid_request',
      geminiErrorCode: 'INVALID_ARGUMENT',
      userMessage: 'Could not process that request. Please rephrase and try again.'
    };
  }

  if (
    causeCode === 'ENOTFOUND' ||
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ECONNRESET' ||
    causeCode === 'ETIMEDOUT' ||
    causeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('network')
  ) {
    return {
      status: 502,
      category: 'network_error',
      geminiErrorCode: causeCode || 'NETWORK_FAILURE',
      userMessage: 'AI service is temporarily unavailable. Please try again.'
    };
  }

  return {
    status: status >= 500 && status <= 599 ? status : 502,
    category: 'server_error',
    geminiErrorCode: status ? `HTTP_${status}` : 'UPSTREAM_ERROR',
    userMessage: 'AI service is temporarily unavailable. Please try again.'
  };
}
