import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { XOS_SYSTEM_SPECIFICATION } from '../../src/services/ai/xosKnowledge.ts';

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

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 16;
const MAX_HISTORY_TURN_CHARS = 1800;
const MAX_CONTEXT_JSON_CHARS = 32000;
const MAX_AUDIO_BASE64_CHARS = 8 * 1024 * 1024; // ~6MB audio binary
const MAX_SPEAK_CHARS = 2000;

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

function getGeminiApiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return trimmed;
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

export async function verifySupabaseSessionToken(
  authHeader?: string | string[],
  fetchImpl: typeof fetch = fetch
): Promise<{ valid: boolean; userId?: string; reason?: string }> {
  const supabaseCfg = getSupabaseServerConfig();
  if (!supabaseCfg) {
    // Allow explicit local unconfigured workspace testing only when Supabase is not configured on the host
    return { valid: true, userId: 'local-workspace' };
  }

  const token = extractBearerToken(authHeader);
  if (!token) {
    return { valid: false, reason: 'Authentication required. Please sign in to use the AI Agent.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetchImpl(`${supabaseCfg.url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: supabaseCfg.anonKey,
        Authorization: `Bearer ${token}`
      },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { valid: false, reason: 'Your session is invalid or expired. Please sign in again.' };
    }

    const userJson = (await response.json()) as { id?: string };
    if (!userJson?.id) {
      return { valid: false, reason: 'Unable to verify authenticated user.' };
    }

    return { valid: true, userId: userJson.id };
  } catch {
    return { valid: false, reason: 'Unable to verify your session right now. Please try again.' };
  }
}

function createAiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
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

export async function handleAssistantRequest(
  payload: unknown,
  authHeader?: string | string[]
): Promise<HandlerResponse> {
  const authCheck = await verifySupabaseSessionToken(authHeader);
  if (!authCheck.valid) {
    return {
      status: 401,
      body: { error: authCheck.reason || 'Unauthorized', code: 'auth_required' }
    };
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      status: 503,
      body: {
        error: 'Gemini AI backend key is not configured. Add GEMINI_API_KEY to your server environment secrets to enable live responses.',
        code: 'unavailable'
      }
    };
  }

  if (!payload || typeof payload !== 'object') {
    return {
      status: 400,
      body: { error: 'Invalid request payload.', code: 'bad_request' }
    };
  }

  const body = payload as Partial<AssistantRequestPayload>;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return {
      status: 400,
      body: { error: 'Message cannot be empty.', code: 'bad_request' }
    };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return {
      status: 400,
      body: { error: 'Message is too long. Please keep questions concise.', code: 'bad_request' }
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
      ? 'User voice setting prefers Malayalam (respond naturally in Malayalam unless user explicitly asks in English).'
      : body.preferredLanguage === 'en-IN'
        ? 'User voice setting prefers English (still understand and respond in Malayalam if user speaks/writes in Malayalam).'
        : 'Auto-detect language from user message: respond naturally in Malayalam for Malayalam/Manglish input, or English for English input.';

  const systemInstruction = `${XOS_SYSTEM_SPECIFICATION}

LANGUAGE DIRECTIVE:
${languageDirective}

CURRENT GROUNDED XOS USER CONTEXT (READ-ONLY VERIFIED CALCULATIONS):
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

  try {
    const ai = createAiClient(apiKey);
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        systemInstruction,
        temperature: 0.35,
        maxOutputTokens: 700,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW
        }
      }
    });

    const reply = (response.text || '').trim();
    if (!reply) {
      return {
        status: 502,
        body: { error: 'AI returned an empty response. Please try again.', code: 'server' }
      };
    }

    return {
      status: 200,
      body: {
        reply,
        detectedLanguage: detectResponseLanguage(reply),
        model: 'gemini-4-hydrogen'
      }
    };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return {
        status: 429,
        body: {
          error: 'AI request rate limit reached. Please wait a moment and try again.',
          code: 'rate_limited'
        }
      };
    }
    return {
      status: 502,
      body: {
        error: 'Unable to reach Gemini right now. Please try again shortly.',
        code: 'server'
      }
    };
  }
}

export async function handleTranscribeRequest(
  payload: unknown,
  authHeader?: string | string[]
): Promise<HandlerResponse> {
  const authCheck = await verifySupabaseSessionToken(authHeader);
  if (!authCheck.valid) {
    return {
      status: 401,
      body: { error: authCheck.reason || 'Unauthorized', code: 'auth_required' }
    };
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      status: 503,
      body: {
        error: 'Gemini AI backend key is not configured for voice transcription.',
        code: 'unavailable'
      }
    };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, body: { error: 'Invalid audio payload.', code: 'bad_request' } };
  }

  const body = payload as Partial<TranscribeRequestPayload>;
  const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';
  const mimeTypeRaw = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : 'audio/webm';
  const baseMime = mimeTypeRaw.split(';')[0].trim();

  if (!audioBase64) {
    return { status: 400, body: { error: 'Audio recording is empty.', code: 'bad_request' } };
  }
  if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    return { status: 400, body: { error: 'Audio clip is too large. Keep voice queries under 45 seconds.', code: 'bad_request' } };
  }
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeTypeRaw) && !ALLOWED_AUDIO_MIME_TYPES.has(baseMime)) {
    return { status: 400, body: { error: 'Unsupported audio format.', code: 'bad_request' } };
  }

  const langHint =
    body.preferredLanguage === 'ml-IN'
      ? 'The speaker is likely speaking Malayalam (or Malayalam mixed with English finance terms).'
      : body.preferredLanguage === 'en-IN'
        ? 'The speaker is likely speaking English (Indian English) or mixed Malayalam-English.'
        : 'The speaker may be speaking English, Malayalam, or natural Malayalam-English code-mixed speech.';

  try {
    const ai = createAiClient(apiKey);
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
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
      }
    });

    const transcript = (response.text || '').trim();
    return {
      status: 200,
      body: { transcript }
    };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return {
        status: 429,
        body: { error: 'Voice transcription rate limit reached. Try typing or retry shortly.', code: 'rate_limited' }
      };
    }
    return {
      status: 502,
      body: { error: 'Could not transcribe voice recording. Please try speaking again or type.', code: 'server' }
    };
  }
}

export async function handleSpeakRequest(
  payload: unknown,
  authHeader?: string | string[]
): Promise<HandlerResponse> {
  const authCheck = await verifySupabaseSessionToken(authHeader);
  if (!authCheck.valid) {
    return {
      status: 401,
      body: { error: authCheck.reason || 'Unauthorized', code: 'auth_required' }
    };
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      status: 503,
      body: {
        error: 'Gemini AI backend key is not configured for voice playback.',
        code: 'unavailable'
      }
    };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, body: { error: 'Invalid speech request.', code: 'bad_request' } };
  }

  const body = payload as Partial<SpeakRequestPayload>;
  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  const cleanSpeechText = sanitizeTextForSpeech(rawText).slice(0, MAX_SPEAK_CHARS);

  if (!cleanSpeechText) {
    return { status: 400, body: { error: 'Speech text cannot be empty.', code: 'bad_request' } };
  }

  try {
    const ai = createAiClient(apiKey);
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
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
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Charon' }
          }
        }
      }
    });

    const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBase64) {
      return {
        status: 502,
        body: { error: 'Speech audio was not generated.', code: 'server' }
      };
    }

    return {
      status: 200,
      body: {
        audioBase64,
        mimeType: 'audio/wav'
      }
    };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return {
        status: 429,
        body: { error: 'Voice synthesis rate limit reached.', code: 'rate_limited' }
      };
    }
    return {
      status: 502,
      body: { error: 'Speech generation failed.', code: 'server' }
    };
  }
}
