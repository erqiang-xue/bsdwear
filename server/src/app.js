import express from 'express';
import { createDecartClient } from '@decartai/sdk';
import { mountAuth } from './auth.js';
import { openAuthStore, resolveAuthDbPath } from './authStore.js';

export const MISSING_KEY_ERROR = '未配置 DECART_API_KEY。请在仓库根目录的 .env 中填写后重启服务。';
export const CREATE_FAILED_ERROR = '创建试穿令牌失败，请检查 DECART_API_KEY 是否有效。';

export function createApp({ env = process.env, createClient = createDecartClient, now = () => Date.now() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  const store = openAuthStore(resolveAuthDbPath(env));
  let auth;
  try {
    auth = mountAuth(app, { store, env, now });
  } catch (error) {
    store.close();
    throw error;
  }
  app.locals.authStore = store;
  app.locals.authSeeded = auth.seededUsername;

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/realtime-token', auth.requireSession, auth.requireCsrf, async (_req, res) => {
    const apiKey = typeof env.DECART_API_KEY === 'string' ? env.DECART_API_KEY.trim() : '';
    if (!apiKey) {
      res.status(500).json({ error: MISSING_KEY_ERROR });
      return;
    }

    try {
      const client = createClient({ apiKey });
      const token = await client.tokens.create();
      if (!token?.apiKey) {
        res.status(502).json({ error: CREATE_FAILED_ERROR });
        return;
      }
      res.json({ apiKey: token.apiKey });
    } catch {
      res.status(502).json({ error: CREATE_FAILED_ERROR });
    }
  });

  return app;
}
