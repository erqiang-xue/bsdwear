import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../src/security.js';
import { defaultEnvPath, loadEnvFile } from '../src/loadEnv.js';

const MISSING_KEY_ERROR = '未配置 DECART_API_KEY。请在仓库根目录的 .env 中填写后重启服务。';
const CREATE_FAILED_ERROR = '创建试穿令牌失败，请检查 DECART_API_KEY 是否有效。';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function authedEnv(extra = {}) {
  return {
    AUTH_SEED: '1',
    AUTH_SEED_USERNAME: '13800001111',
    AUTH_SEED_PASSWORD: 'demo-pass-8',
    ...extra,
  };
}

async function login(base) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '13800001111', password: 'demo-pass-8' }),
  });
  const setCookies = response.headers.getSetCookie();
  const jar = {};
  for (const header of setCookies) {
    const pair = header.split(';', 1)[0];
    const index = pair.indexOf('=');
    jar[pair.slice(0, index)] = decodeURIComponent(pair.slice(index + 1));
  }
  return {
    Cookie: `${SESSION_COOKIE}=${jar[SESSION_COOKIE]}; ${CSRF_COOKIE}=${jar[CSRF_COOKIE]}`,
    'X-CSRF-Token': jar[CSRF_COOKIE],
  };
}

test('GET /api/health reports the service is up', async () => {
  const { server, base } = await listen(createApp({ env: {} }));
  try {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await close(server);
  }
});

test('POST /api/realtime-token returns a short-lived client token', async () => {
  const calls = [];
  const createClient = (options) => {
    calls.push(options);
    return {
      tokens: {
        create: async () => ({ apiKey: 'ek_short_lived', expiresAt: '2026-10-17T00:01:00Z' }),
      },
    };
  };

  const app = createApp({
    env: authedEnv({ DECART_API_KEY: 'dct_permanent' }),
    createClient,
  });
  const { server, base } = await listen(app);

  try {
    const headers = await login(base);
    const response = await fetch(`${base}/api/realtime-token`, { method: 'POST', headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { apiKey: 'ek_short_lived' });
    assert.deepEqual(calls, [{ apiKey: 'dct_permanent' }]);
  } finally {
    await close(server);
    app.locals.authStore.close();
  }
});

test('POST /api/realtime-token does not echo the permanent key', async () => {
  const createClient = () => ({
    tokens: {
      create: async () => {
        throw new Error('rejected dct_permanent');
      },
    },
  });

  const app = createApp({
      env: authedEnv({ DECART_API_KEY: 'dct_permanent' }),
      createClient,
    });
  const { server, base } = await listen(app);

  try {
    const headers = await login(base);
    const response = await fetch(`${base}/api/realtime-token`, { method: 'POST', headers });
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(body).error, CREATE_FAILED_ERROR);
    assert.equal(body.includes('dct_permanent'), false);
  } finally {
    await close(server);
    app.locals.authStore.close();
  }
});

test('POST /api/realtime-token explains a missing key in Chinese', async () => {
  let called = false;
  const app = createApp({
      env: authedEnv({ DECART_API_KEY: '   ' }),
      createClient: () => {
        called = true;
        throw new Error('should not mint');
      },
    });
  const { server, base } = await listen(app);

  try {
    const headers = await login(base);
    const response = await fetch(`${base}/api/realtime-token`, { method: 'POST', headers });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: MISSING_KEY_ERROR });
    assert.equal(called, false);
  } finally {
    await close(server);
    app.locals.authStore.close();
  }
});

test('tokens.create is called without fast-mode options', async () => {
  let createOptions = 'not-called';
  const createClient = () => ({
    tokens: {
      create: async (options) => {
        createOptions = options;
        return { apiKey: 'ek_ok', expiresAt: '2026-10-17T00:01:00Z' };
      },
    },
  });

  const app = createApp({
      env: authedEnv({ DECART_API_KEY: 'dct_ok' }),
      createClient,
    });
  const { server, base } = await listen(app);

  try {
    const headers = await login(base);
    const response = await fetch(`${base}/api/realtime-token`, { method: 'POST', headers });
    assert.equal(response.status, 200);
    assert.equal(createOptions, undefined);
  } finally {
    await close(server);
    app.locals.authStore.close();
  }
});

test('default env file is the repository root .env', () => {
  assert.equal(defaultEnvPath, path.resolve(import.meta.dirname, '../../.env'));
});

test('loadEnvFile reads DECART_API_KEY from an env file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsdwear-'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, 'DECART_API_KEY=dct_from_file\n');
  const sink = {};
  try {
    assert.equal(loadEnvFile(envPath, sink), envPath);
    assert.equal(sink.DECART_API_KEY, 'dct_from_file');
    assert.equal(process.env.DECART_API_KEY, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
