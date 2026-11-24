import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  handleAssistantRequest,
  handleSpeakRequest,
  handleTranscribeRequest
} from './api/_lib/aiHandler.js';

import { getGeminiApiKey } from './api/_lib/gemini.js';
import { getGroqApiKey } from './api/_lib/groq.js';

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const KNOWN_SPA_PATHS = new Set([
  '/',
  '/login',
  '/signup',
  '/magic-link',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/auth/callback'
]);

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  // Lightweight health endpoint (no secret disclosure)
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const groqConfigured = Boolean(getGroqApiKey());
    const geminiConfigured = Boolean(getGeminiApiKey());
    res.json({
      ok: true,
      aiConfigured: groqConfigured || geminiConfigured,
      primaryProvider: groqConfigured ? 'groq' : geminiConfigured ? 'gemini' : 'unconfigured',
      fallbackConfigured: geminiConfigured
    });
  });

  // Server-side Gemini AI endpoints (Bearer token verified inside handlers)
  app.post('/api/ai/assistant', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
      const result = await handleAssistantRequest(req.body, req.headers.authorization);
      res.status(result.status).json(result.body);
    } catch {
      res.status(500).json({ error: 'Unexpected AI assistant server error.', code: 'server_error', category: 'server_error' });
    }
  });

  app.post('/api/ai/transcribe', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
      const result = await handleTranscribeRequest(req.body, req.headers.authorization);
      res.status(result.status).json(result.body);
    } catch {
      res.status(500).json({ error: 'Unexpected voice transcription server error.', code: 'server_error', category: 'server_error' });
    }
  });

  app.post('/api/ai/speak', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
      const result = await handleSpeakRequest(req.body, req.headers.authorization);
      res.status(result.status).json(result.body);
    } catch {
      res.status(500).json({ error: 'Unexpected voice synthesis server error.', code: 'server_error', category: 'server_error' });
    }
  });

  // Explicit 404 JSON for unknown /api/* routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.', code: 'not_found', category: 'server_error' });
  });

  // Ensure JSON parse/body errors on /api/* return structured JSON instead of HTML
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 400;
    res.status(status).json({
      error: 'Invalid request payload.',
      code: 'invalid_request',
      category: 'invalid_request',
      stage: 'validation'
    });
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    const indexPath = path.join(distDir, 'index.html');
    const notFoundPath = path.join(distDir, '404.html');

    app.use(express.static(distDir, { index: false }));

    app.get('*', (req, res) => {
      const normalized = (req.path || '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase() || '/';
      if (KNOWN_SPA_PATHS.has(normalized) && fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
        return;
      }
      if (fs.existsSync(notFoundPath)) {
        res.status(404).sendFile(notFoundPath);
        return;
      }
      if (fs.existsSync(indexPath)) {
        res.status(404).sendFile(indexPath);
        return;
      }
      res.status(404).send('Not Found');
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`XOS server listening on http://0.0.0.0:${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start XOS server:', err);
  process.exit(1);
});
