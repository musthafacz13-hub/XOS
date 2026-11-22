/**
 * XOS Personal AI Agent — Frontend Service Interface
 * Communicates strictly with backend /api/ai/* routes using authenticated user Bearer tokens.
 * Never embeds API keys or invokes any XOS repository write operations.
 */
import { supabase, isSupabaseConfigured } from '../supabase';
import { SessionTurnMemory } from './contextBuilder';

export type PreferredVoiceLanguage = 'auto' | 'ml-IN' | 'en-IN';

export type AiServiceErrorCode =
  | 'unavailable'
  | 'auth_required'
  | 'rate_limited'
  | 'bad_request'
  | 'network'
  | 'server';

export class AiServiceError extends Error {
  code: AiServiceErrorCode;
  status?: number;

  constructor(message: string, code: AiServiceErrorCode, status?: number) {
    super(message);
    this.name = 'AiServiceError';
    this.code = code;
    this.status = status;
  }
}

export interface AssistantReplyResult {
  reply: string;
  detectedLanguage: 'ml' | 'en' | 'mixed';
  model?: string;
}

export interface TranscribeResult {
  transcript: string;
}

export interface SpeakResult {
  audioBase64: string;
  mimeType: string;
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

async function postAiEndpoint<T>(
  endpoint: string,
  body: Record<string, unknown>,
  accessToken?: string | null,
  timeoutMs: number = 25000
): Promise<T> {
  const token = await resolveBearerToken(accessToken);
  if (isSupabaseConfigured && !token) {
    throw new AiServiceError(
      'Please sign in with an active XOS session to talk to the AI Agent.',
      'auth_required',
      401
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new AiServiceError(
        'AI backend service is not reachable in this environment.',
        'unavailable',
        response.status
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const code = (data.code as AiServiceErrorCode) ||
        (response.status === 401
          ? 'auth_required'
          : response.status === 429
            ? 'rate_limited'
            : response.status === 503 || response.status === 404
              ? 'unavailable'
              : 'server');
      const message =
        typeof data.error === 'string' && data.error.trim()
          ? data.error
          : 'Unable to complete AI request right now.';
      throw new AiServiceError(message, code, response.status);
    }

    return data as T;
  } catch (err) {
    if (err instanceof AiServiceError) {
      throw err;
    }
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new AiServiceError('The AI request timed out. Please try again.', 'network');
    }
    throw new AiServiceError(
      'Unable to connect to the AI service. Check your connection and try again.',
      'network'
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export const agentService = {
  async sendMessage(params: {
    message: string;
    history: SessionTurnMemory[];
    groundedContext: Record<string, unknown>;
    preferredLanguage: PreferredVoiceLanguage;
    accessToken?: string | null;
  }): Promise<AssistantReplyResult> {
    return postAiEndpoint<AssistantReplyResult>(
      '/api/ai/assistant',
      {
        message: params.message,
        history: params.history.map(h => ({ role: h.role, text: h.text })),
        groundedContext: params.groundedContext,
        preferredLanguage: params.preferredLanguage
      },
      params.accessToken,
      25000
    );
  },

  async transcribeAudio(params: {
    audioBase64: string;
    mimeType: string;
    preferredLanguage: PreferredVoiceLanguage;
    accessToken?: string | null;
  }): Promise<TranscribeResult> {
    return postAiEndpoint<TranscribeResult>(
      '/api/ai/transcribe',
      {
        audioBase64: params.audioBase64,
        mimeType: params.mimeType,
        preferredLanguage: params.preferredLanguage
      },
      params.accessToken,
      25000
    );
  },

  async synthesizeSpeech(params: {
    text: string;
    languageHint?: 'ml' | 'en' | 'mixed';
    accessToken?: string | null;
  }): Promise<SpeakResult> {
    return postAiEndpoint<SpeakResult>(
      '/api/ai/speak',
      {
        text: params.text,
        languageHint: params.languageHint
      },
      params.accessToken,
      20000
    );
  }
};
