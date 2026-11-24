/**
 * XOS Personal AI Agent — Server-Side Groq API Client & Error Classifier
 * Uses official Groq OpenAI-compatible HTTP endpoint: https://api.groq.com/openai/v1
 * Reads process.env.GROQ_API_KEY exclusively on the server.
 */
import type { AiErrorCategory, ClassifiedGeminiError } from './gemini.js';

export const GROQ_API_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_PRIMARY_MODEL = 'openai/gpt-oss-20b';
export const GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';
export const GROQ_MAX_COMPLETION_TOKENS = 1536;
export const GROQ_TEMPERATURE = 0.2;

export function getGroqApiKey(): string | null {
  const raw = process.env.GROQ_API_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'MY_GROQ_API_KEY') {
    return null;
  }
  return trimmed;
}

export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqChatCompletionResult {
  reply: string;
  model: string;
  finishReason?: string;
}

export function classifyGroqError(
  errOrStatus: unknown,
  wasAbortedByServerDeadline: boolean,
  bodyErrorMessage?: string,
  bodyErrorCode?: string
): ClassifiedGeminiError {
  const isNumberStatus = typeof errOrStatus === 'number';
  const status = isNumberStatus
    ? errOrStatus
    : Number((errOrStatus as { status?: number; statusCode?: number })?.status || 0);

  const errObj = (!isNumberStatus && errOrStatus && typeof errOrStatus === 'object'
    ? errOrStatus
    : {}) as {
    code?: string;
    name?: string;
    message?: string;
    cause?: { code?: string; name?: string; message?: string };
  };

  const rawMessage = bodyErrorMessage || errObj.message || (isNumberStatus ? `HTTP_${status}` : String(errOrStatus || ''));
  const lowerMsg = rawMessage.toLowerCase();
  const code = (bodyErrorCode || errObj.cause?.code || errObj.code || '').toUpperCase();
  const errName = (errObj.name || '').toLowerCase();

  if (
    wasAbortedByServerDeadline ||
    errName === 'aborterror' ||
    errName === 'timeouterror' ||
    code === 'ABORT_ERR' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    status === 504 ||
    status === 408 ||
    lowerMsg.includes('aborted') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout')
  ) {
    return {
      status: 504,
      category: 'timeout',
      geminiErrorCode: code || 'GROQ_DEADLINE_EXCEEDED',
      userMessage: 'AI is taking longer than expected. Please try again.'
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    code === 'INVALID_API_KEY' ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('authentication') ||
    lowerMsg.includes('unauthorized')
  ) {
    return {
      status: 502,
      category: 'invalid_api_key',
      geminiErrorCode: status === 403 ? 'GROQ_PERMISSION_DENIED' : 'GROQ_API_KEY_INVALID',
      userMessage: 'AI service is temporarily unavailable.'
    };
  }

  if (
    status === 404 ||
    code === 'MODEL_NOT_FOUND' ||
    (lowerMsg.includes('model') && (lowerMsg.includes('not found') || lowerMsg.includes('does not exist') || lowerMsg.includes('decommissioned')))
  ) {
    return {
      status: 502,
      category: 'model_unavailable',
      geminiErrorCode: 'GROQ_MODEL_NOT_FOUND',
      userMessage: 'AI service is temporarily unavailable.'
    };
  }

  if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
    const isQuota =
      lowerMsg.includes('quota') ||
      lowerMsg.includes('billing') ||
      lowerMsg.includes('credit') ||
      lowerMsg.includes('insufficient_quota');

    if (isQuota) {
      return {
        status: 429,
        category: 'quota_exceeded',
        geminiErrorCode: 'GROQ_QUOTA_EXCEEDED',
        userMessage: 'AI service is temporarily unavailable.'
      };
    }
    return {
      status: 429,
      category: 'rate_limited',
      geminiErrorCode: 'GROQ_RATE_LIMIT',
      userMessage: 'AI service is busy right now. Please wait a moment and try again.'
    };
  }

  if (
    code === 'JSON_VALIDATE_FAILED' ||
    lowerMsg.includes('json_validate_failed') ||
    lowerMsg.includes('failed to generate json')
  ) {
    return {
      status: 502,
      category: 'invalid_response',
      geminiErrorCode: 'GROQ_JSON_VALIDATE_FAILED',
      userMessage: 'Received an unexpected response from the AI service. Please try again.'
    };
  }

  if (
    status === 413 ||
    lowerMsg.includes('request too large') ||
    lowerMsg.includes('reduce the length') ||
    lowerMsg.includes('context_length_exceeded')
  ) {
    return {
      status: 413,
      category: 'server_error',
      geminiErrorCode: 'GROQ_CONTEXT_TOO_LARGE',
      userMessage: 'AI service is temporarily unavailable. Please try again.'
    };
  }

  if (status === 400 || status === 422 || code === 'INVALID_REQUEST_ERROR') {
    return {
      status: 400,
      category: 'invalid_request',
      geminiErrorCode: code || 'GROQ_INVALID_REQUEST',
      userMessage: 'Could not process that request. Please rephrase and try again.'
    };
  }

  if (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('network')
  ) {
    return {
      status: 502,
      category: 'network_error',
      geminiErrorCode: code || 'GROQ_NETWORK_FAILURE',
      userMessage: 'AI service is temporarily unavailable. Please try again.'
    };
  }

  return {
    status: status >= 500 && status <= 599 ? status : 502,
    category: 'server_error',
    geminiErrorCode: status ? `GROQ_HTTP_${status}` : 'GROQ_UPSTREAM_ERROR',
    userMessage: 'AI service is temporarily unavailable. Please try again.'
  };
}

export function isFallbackEligibleCategory(category: AiErrorCategory): boolean {
  return (
    category === 'server_error' ||
    category === 'network_error' ||
    category === 'model_unavailable' ||
    category === 'rate_limited' ||
    category === 'quota_exceeded' ||
    category === 'invalid_response'
  );
}

export class GroqApiError extends Error {
  classified: ClassifiedGeminiError;

  constructor(classified: ClassifiedGeminiError) {
    super(classified.userMessage);
    this.name = 'GroqApiError';
    this.classified = classified;
  }
}

interface GroqChatResponseJson {
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: string;
  }>;
  error?: { message?: string; code?: string; type?: string };
}

function safeParseJsonObject<T>(rawText: string): T | null {
  if (!rawText.trim()) return null;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export async function callGroqChatCompletion(params: {
  apiKey: string;
  messages: GroqChatMessage[];
  abortSignal: AbortSignal;
  fetchImpl?: typeof fetch;
  model?: string;
  maxCompletionTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  responseFormat?: 'json_object';
}): Promise<GroqChatCompletionResult> {
  const fetchFn = params.fetchImpl ?? fetch;
  const model = params.model ?? GROQ_PRIMARY_MODEL;

  const requestBody: Record<string, unknown> = {
    model,
    messages: params.messages,
    reasoning_effort: params.reasoningEffort ?? 'low',
    max_completion_tokens: params.maxCompletionTokens ?? GROQ_MAX_COMPLETION_TOKENS,
    temperature: params.temperature ?? GROQ_TEMPERATURE,
    stream: false
  };
  if (params.responseFormat === 'json_object') {
    requestBody.response_format = { type: 'json_object' };
  }

  let response: Response;
  try {
    response = await fetchFn(`${GROQ_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: params.abortSignal
    });
  } catch (err) {
    throw new GroqApiError(classifyGroqError(err, params.abortSignal.aborted));
  }

  let parsed: GroqChatResponseJson | null = null;
  try {
    const rawText = await response.text();
    parsed = safeParseJsonObject<GroqChatResponseJson>(rawText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new GroqApiError(
      classifyGroqError(
        response.status,
        params.abortSignal.aborted,
        parsed?.error?.message,
        parsed?.error?.code || parsed?.error?.type
      )
    );
  }

  const content = parsed?.choices?.[0]?.message?.content;
  const reply = typeof content === 'string' ? content.trim() : '';
  const finishReason = parsed?.choices?.[0]?.finish_reason;

  return {
    reply,
    model,
    finishReason
  };
}

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac'
};

const WHISPER_PROMPTS: Record<'auto' | 'ml-IN' | 'en-IN', string> = {
  'ml-IN':
    'Kerala Malayalam and Manglish personal finance question about expense, income, debt, savings, salary, attendance, goals, ചെലവ്, വരവ്, കടം, ശമ്പളം, പൈസ.',
  'en-IN':
    'Indian English personal finance question about expenses, income, debt, savings, salary, attendance, and financial goals.',
  auto:
    'Malayalam, Manglish, or Indian English personal finance question: expense, income, debt, savings, salary, attendance, ചെലവ്, വരവ്, കടം, ശമ്പളം.'
};

const ALLOWED_AUTO_WHISPER_LANGUAGES = new Set([
  'ml',
  'malayalam',
  'en',
  'english'
]);

const WHISPER_SILENCE_HALLUCINATIONS = [
  'thank you for watching',
  'thanks for watching',
  'subtitles by',
  'amara.org',
  'please subscribe',
  'you'
];

export interface GroqTranscriptionResult {
  transcript: string;
  model: string;
  detectedLanguage?: string;
  rejectionReason?: 'no_speech' | 'unsupported_detected_language';
}

export async function callGroqTranscription(params: {
  apiKey: string;
  audioBase64: string;
  mimeType: string;
  preferredLanguage?: 'auto' | 'ml-IN' | 'en-IN';
  abortSignal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<GroqTranscriptionResult> {
  const fetchFn = params.fetchImpl ?? fetch;
  const baseMime = params.mimeType.split(';')[0].trim().toLowerCase() || 'audio/webm';
  const ext = MIME_TO_EXT[baseMime] || 'webm';
  const prefLang = params.preferredLanguage || 'ml-IN';

  const buffer = Buffer.from(params.audioBase64, 'base64');
  const blob = new Blob([buffer], { type: baseMime });

  const form = new FormData();
  form.append('file', blob, `voice-query.${ext}`);
  form.append('model', GROQ_TRANSCRIBE_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  form.append('prompt', WHISPER_PROMPTS[prefLang] || WHISPER_PROMPTS['ml-IN']);
  if (prefLang === 'ml-IN') {
    form.append('language', 'ml');
  } else if (prefLang === 'en-IN') {
    form.append('language', 'en');
  }

  let response: Response;
  try {
    response = await fetchFn(`${GROQ_API_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`
      },
      body: form,
      signal: params.abortSignal
    });
  } catch (err) {
    throw new GroqApiError(classifyGroqError(err, params.abortSignal.aborted));
  }

  interface GroqVerboseTranscribeJson {
    text?: unknown;
    language?: unknown;
    duration?: unknown;
    segments?: Array<{
      no_speech_prob?: unknown;
      avg_logprob?: unknown;
      text?: unknown;
    }>;
    error?: { message?: string; code?: string; type?: string };
  }

  let parsed: GroqVerboseTranscribeJson | null = null;
  try {
    const rawText = await response.text();
    parsed = safeParseJsonObject<GroqVerboseTranscribeJson>(rawText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new GroqApiError(
      classifyGroqError(
        response.status,
        params.abortSignal.aborted,
        parsed?.error?.message,
        parsed?.error?.code || parsed?.error?.type
      )
    );
  }

  const rawTranscript = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  const detectedLanguage =
    typeof parsed?.language === 'string' ? parsed.language.trim().toLowerCase() : undefined;
  const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];

  const avgNoSpeechProb =
    segments.length > 0
      ? segments.reduce((acc, seg) => acc + (typeof seg.no_speech_prob === 'number' ? seg.no_speech_prob : 0), 0) /
        segments.length
      : 0;

  // Reject pure silence or known Whisper silent boilerplate hallucinations
  if (
    !rawTranscript ||
    (segments.length > 0 && segments.every(seg => typeof seg.no_speech_prob === 'number' && seg.no_speech_prob >= 0.88)) ||
    (avgNoSpeechProb >= 0.6 &&
      WHISPER_SILENCE_HALLUCINATIONS.some(phrase => rawTranscript.toLowerCase().replace(/[.!,?]/g, '').trim() === phrase))
  ) {
    return {
      transcript: '',
      model: GROQ_TRANSCRIBE_MODEL,
      detectedLanguage,
      rejectionReason: 'no_speech'
    };
  }

  // Prevent unrelated languages (e.g., Spanish/French) in 'auto' mode
  if (
    prefLang === 'auto' &&
    detectedLanguage &&
    !ALLOWED_AUTO_WHISPER_LANGUAGES.has(detectedLanguage) &&
    !/[\u0D00-\u0D7F]/.test(rawTranscript)
  ) {
    return {
      transcript: '',
      model: GROQ_TRANSCRIBE_MODEL,
      detectedLanguage,
      rejectionReason: 'unsupported_detected_language'
    };
  }

  return {
    transcript: rawTranscript,
    model: GROQ_TRANSCRIBE_MODEL,
    detectedLanguage
  };
}
