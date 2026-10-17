import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
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

  const { server, base } = await listen(
    createApp({
      env: { DECART_API_KEY: 'dct_permanent' },
      createClient,
    }),
  );

  try {
    const response = await fetch(`${base}/api/realtime-token`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { apiKey: 'ek_short_lived' });
    assert.deepEqual(calls, [{ apiKey: 'dct_permanent' }]);
  } finally {
    await close(server);
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

  const { server, base } = await listen(
    createApp({
      env: { DECART_API_KEY: 'dct_permanent' },
      createClient,
    }),
  );

  try {
    const response = await fetch(`${base}/api/realtime-token`, { method: 'POST' });
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(body).error, CREATE_FAILED_ERROR);
    assert.equal(body.includes('dct_permanent'), false);
  } finally {
    await close(server);
  }
});

test('POST /api/realtime-token explains a missing key in Chinese', async () => {
  let called = false;
  const { server, base } = await listen(
    createApp({
      env: { DECART_API_KEY: '   ' },
      createClient: () => {
        called = true;
        throw new Error('should not mint');
      },
    }),
  );

  try {
    const response = await fetch(`${base}/api/realtime-token`, { method: 'POST' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: MISSING_KEY_ERROR });
    assert.equal(called, false);
  } finally {
    await close(server);
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

  const { server, base } = await listen(
    createApp({
      env: { DECART_API_KEY: 'dct_ok' },
      createClient,
    }),
  );

  try {
    const response = await fetch(`${base}/api/realtime-token`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(createOptions, undefined);
  } finally {
    await close(server);
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
