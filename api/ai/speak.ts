import { handleSpeakRequest } from '../_lib/aiHandler.js';

interface VercelReq {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (data: Record<string, unknown>) => void;
  setHeader: (name: string, value: string) => void;
}

function normalizeBody(raw: unknown): unknown {
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return null;
    }
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      error: 'Method not allowed.',
      code: 'invalid_request',
      category: 'invalid_request',
      stage: 'validation'
    });
    return;
  }

  try {
    const result = await handleSpeakRequest(normalizeBody(req.body), req.headers.authorization);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error(JSON.stringify({
      event: 'ai_speak_unhandled',
      error: err instanceof Error ? err.message : 'Unhandled error'
    }));
    res.status(500).json({
      error: 'AI service is temporarily unavailable. Please try again.',
      code: 'server_error',
      category: 'server_error',
      stage: 'vercel'
    });
  }
}
