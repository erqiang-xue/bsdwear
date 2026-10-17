import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOP_GARMENT_PROMPT,
  cameraConstraints,
  createTryOnDecartClient,
  createTryOnSession,
  describeStartError,
  fetchRealtimeApiKey,
} from '../src/tryOn.js';

test('camera constraints use the model fps, width, and height when present', () => {
  assert.deepEqual(
    cameraConstraints({ fps: 24, width: 1280, height: 720 }),
    {
      audio: false,
      video: {
        facingMode: 'user',
        frameRate: 24,
        width: 1280,
        height: 720,
      },
    },
  );
});

test('camera constraints stay valid when the model omits capture hints', () => {
  assert.deepEqual(cameraConstraints({}), {
    audio: false,
    video: { facingMode: 'user' },
  });
  assert.deepEqual(cameraConstraints(undefined), {
    audio: false,
    video: { facingMode: 'user' },
  });
});

test('fetchRealtimeApiKey posts to the token endpoint and returns apiKey', async () => {
  const calls = [];
  const apiKey = await fetchRealtimeApiKey(async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ apiKey: 'ek_from_server' }),
    };
  });

  assert.equal(apiKey, 'ek_from_server');
  assert.deepEqual(calls, [{ url: '/api/realtime-token', init: { method: 'POST' } }]);
});

test('fetchRealtimeApiKey surfaces the server Chinese error', async () => {
  await assert.rejects(
    () =>
      fetchRealtimeApiKey(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: '未配置 DECART_API_KEY。请在仓库根目录的 .env 中填写后重启服务。' }),
      })),
    /未配置 DECART_API_KEY/,
  );
});

test('fetchRealtimeApiKey explains a network failure in Chinese', async () => {
  await assert.rejects(
    () =>
      fetchRealtimeApiKey(async () => {
        throw new TypeError('Failed to fetch');
      }),
    /无法连接试穿服务/,
  );
});

test('createTryOnDecartClient asks the SDK for a token on each connect', async () => {
  let provider;
  const client = createTryOnDecartClient((options) => {
    provider = options.apiKeyProvider;
    return { created: true };
  }, async () => ({
    ok: true,
    json: async () => ({ apiKey: 'ek_provider' }),
  }));

  assert.equal(client.created, true);
  assert.equal(await provider(), 'ek_provider');
});

test('session connects the camera and applies a garment without reconnecting', async () => {
  const model = { name: 'lucy-vton-latest', fps: 25, width: 720, height: 1280 };
  const sets = [];
  const connects = [];
  let disconnected = false;
  const stoppedTracks = [];
  const remote = { id: 'remote' };

  const session = createTryOnSession({
    model,
    getUserMedia: async (constraints) => {
      assert.deepEqual(constraints, cameraConstraints(model));
      return {
        getTracks: () => [{ stop: () => stoppedTracks.push('cam') }],
      };
    },
    createClient: () => ({
      realtime: {
        connect: async (stream, options) => {
          connects.push(options);
          options.onRemoteStream(remote);
          return {
            set: async (input) => {
              sets.push(input);
            },
            disconnect: () => {
              disconnected = true;
            },
            on: () => {},
          };
        },
      },
    }),
  });

  const seen = [];
  await session.start({ onRemoteStream: (stream) => seen.push(stream) });
  assert.deepEqual(seen, [remote]);
  assert.equal(connects[0].model, model);
  assert.equal(connects[0].mirror, 'auto');
  assert.equal(connects.length, 1);

  const file = { name: 'top.png' };
  const applied = await session.applyGarment(file);
  assert.deepEqual(applied, { applied: true });
  assert.deepEqual(sets, [
    {
      prompt: TOP_GARMENT_PROMPT,
      image: file,
      enhance: true,
    },
  ]);

  const next = { name: 'other.jpg' };
  await session.applyGarment(next);
  assert.equal(connects.length, 1);
  assert.equal(sets[1].image, next);
  assert.equal(sets[1].enhance, true);

  session.stop();
  assert.equal(disconnected, true);
  assert.deepEqual(stoppedTracks, ['cam']);
});

test('a garment chosen before connect is applied once the stream is up', async () => {
  const sets = [];
  const session = createTryOnSession({
    model: { fps: 24, width: 640, height: 480 },
    getUserMedia: async () => ({ getTracks: () => [] }),
    createClient: () => ({
      realtime: {
        connect: async (_stream, options) => {
          options.onRemoteStream({});
          return {
            set: async (input) => sets.push(input),
            disconnect: () => {},
            on: () => {},
          };
        },
      },
    }),
  });

  const file = { name: 'queued.webp' };
  assert.deepEqual(await session.applyGarment(file), { applied: false });
  await session.start({ onRemoteStream: () => {} });
  assert.equal(sets.length, 1);
  assert.equal(sets[0].image, file);
  assert.equal(sets[0].prompt, 'Substitute the current top with the garment in the reference image');
});

test('stop during connect discards the session', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let markConnected;
  const connectEntered = new Promise((resolve) => {
    markConnected = resolve;
  });
  let disconnected = false;
  const stopped = [];

  const session = createTryOnSession({
    model: {},
    getUserMedia: async () => ({
      getTracks: () => [{ stop: () => stopped.push('cam') }],
    }),
    createClient: () => ({
      realtime: {
        connect: async () => {
          markConnected();
          await gate;
          return {
            set: async () => {},
            disconnect: () => {
              disconnected = true;
            },
            on: () => {},
          };
        },
      },
    }),
  });

  const pending = session.start({ onRemoteStream: () => {} });
  await connectEntered;
  session.stop();
  release();
  assert.equal(await pending, null);
  assert.equal(disconnected, true);
  assert.deepEqual(stopped, ['cam']);
});

test('an overconstrained camera falls back to a basic user-facing camera', async () => {
  const calls = [];
  const session = createTryOnSession({
    model: { fps: 30, width: 1280, height: 720 },
    getUserMedia: async (constraints) => {
      calls.push(constraints);
      if (calls.length === 1) {
        const error = new Error('overconstrained');
        error.name = 'OverconstrainedError';
        throw error;
      }
      return { getTracks: () => [] };
    },
    createClient: () => ({
      realtime: {
        connect: async (_stream, options) => {
          options.onRemoteStream({});
          return { set: async () => {}, disconnect: () => {}, on: () => {} };
        },
      },
    }),
  });

  await session.start({ onRemoteStream: () => {} });
  assert.deepEqual(calls[1], { audio: false, video: { facingMode: 'user' } });
});

test('connect failure stops the camera', async () => {
  const stopped = [];
  const session = createTryOnSession({
    model: {},
    getUserMedia: async () => ({
      getTracks: () => [{ stop: () => stopped.push('cam') }],
    }),
    createClient: () => ({
      realtime: {
        connect: async () => {
          throw new Error('dial failed');
        },
      },
    }),
  });

  await assert.rejects(() => session.start({ onRemoteStream: () => {} }), /dial failed/);
  assert.deepEqual(stopped, ['cam']);
});

test('describeStartError names camera and token failures in Chinese', () => {
  assert.match(describeStartError({ name: 'NotAllowedError' }), /摄像头/);
  assert.match(describeStartError({ name: 'NotFoundError' }), /未检测到摄像头/);
  assert.equal(
    describeStartError(new Error('未配置 DECART_API_KEY。请在仓库根目录的 .env 中填写后重启服务。')),
    '未配置 DECART_API_KEY。请在仓库根目录的 .env 中填写后重启服务。',
  );
  assert.match(describeStartError(new Error('connect failed')), /connect failed/);
});
