import { handleAssistantRequest } from '../_lib/aiHandler.ts';

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

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.', code: 'method_not_allowed' });
    return;
  }

  const result = await handleAssistantRequest(req.body, req.headers.authorization);
  res.status(result.status).json(result.body);
}
