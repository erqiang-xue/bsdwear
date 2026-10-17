import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MAX_SESSION_MS,
  TOP_GARMENT_PROMPT,
  cameraConstraints,
  createPreviewRecorder,
  createTryOnDecartClient,
  createTryOnSession,
  describeAutoStop,
  describeStartError,
  downloadBlob,
  fetchRealtimeApiKey,
  mediaStreamFromVideo,
  parseMaxSeconds,
  preferredRecordingMimeType,
  recordingFilename,
  replaySourceFromFile,
  showLiveStream,
  showReplay,
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
  session.stop();
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
  session.stop();
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

function fakeSession({ onDisconnect, onTrackStop } = {}) {
  const stopped = [];
  const scheduled = [];
  const session = createTryOnSession({
    model: {},
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms, cancelled: false });
      return scheduled.length;
    },
    cancelSchedule: (id) => {
      const entry = scheduled[id - 1];
      if (entry) entry.cancelled = true;
    },
    getUserMedia: async () => ({
      getTracks: () => [
        {
          stop: () => {
            stopped.push('cam');
            onTrackStop?.();
          },
        },
      ],
    }),
    createClient: () => ({
      realtime: {
        connect: async (_stream, options) => {
          options.onRemoteStream?.({});
          return {
            set: async () => {},
            disconnect: () => onDisconnect?.(),
            on: () => {},
          };
        },
      },
    }),
  });
  session.scheduled = scheduled;
  session.stoppedTracks = stopped;
  return session;
}

test('the default auto-stop limit is 10 seconds', () => {
  assert.equal(DEFAULT_MAX_SESSION_MS, 10_000);
  assert.equal(describeAutoStop(), '已自动停止（默认最长 10 秒）');
  assert.equal(describeAutoStop(10_000), '已自动停止（默认最长 10 秒）');
  assert.equal(describeAutoStop(15_000), '已自动停止（最长 15 秒）');
});

test('parseMaxSeconds keeps the default and clamps the control', () => {
  assert.equal(parseMaxSeconds(''), 10);
  assert.equal(parseMaxSeconds('10'), 10);
  assert.equal(parseMaxSeconds('4.2'), 4);
  assert.equal(parseMaxSeconds(0), 1);
  assert.equal(parseMaxSeconds(500), 120);
});

test('a live session auto-stops after the default 10 seconds', async () => {
  let disconnected = false;
  const auto = [];
  const session = fakeSession({
    onDisconnect: () => {
      disconnected = true;
    },
  });

  const client = await session.start({
    onRemoteStream: () => {},
    onAutoStop: (info) => auto.push(info),
  });
  assert.ok(client);
  assert.equal(session.scheduled.length, 1);
  assert.equal(session.scheduled[0].ms, 10_000);
  assert.equal(disconnected, false);

  await session.scheduled[0].fn();
  assert.equal(disconnected, true);
  assert.deepEqual(session.stoppedTracks, ['cam']);
  assert.deepEqual(auto, [{ maxDurationMs: 10_000 }]);
});

test('a custom max duration replaces the 10 second default', async () => {
  const session = fakeSession();
  await session.start({ onRemoteStream: () => {}, maxDurationMs: 4_000 });
  assert.equal(session.scheduled[0].ms, 4_000);
  session.stop();
});

test('manual stop cancels the auto-stop timer', async () => {
  let disconnects = 0;
  const auto = [];
  const session = fakeSession({
    onDisconnect: () => {
      disconnects += 1;
    },
  });

  await session.start({
    onRemoteStream: () => {},
    onAutoStop: (info) => auto.push(info),
  });
  session.stop();
  assert.equal(session.scheduled[0].cancelled, true);
  assert.equal(disconnects, 1);
  assert.deepEqual(session.stoppedTracks, ['cam']);

  await session.scheduled[0].fn();
  assert.equal(auto.length, 0);
  assert.equal(disconnects, 1);
});

test('auto-stop flushes the before-stop hook before disconnecting', async () => {
  const order = [];
  const session = fakeSession({
    onDisconnect: () => order.push('disconnect'),
    onTrackStop: () => order.push('tracks'),
  });

  await session.start({
    onRemoteStream: () => {},
    onBeforeAutoStop: async () => {
      order.push('flush');
    },
    onAutoStop: () => order.push('status'),
  });

  await session.scheduled[0].fn();
  assert.deepEqual(order, ['flush', 'disconnect', 'tracks', 'status']);
});

test('a local stop ignores a later sessionEnded callback', async () => {
  let onEnded;
  const reasons = [];
  const session = createTryOnSession({
    model: {},
    schedule: () => 1,
    cancelSchedule: () => {},
    getUserMedia: async () => ({ getTracks: () => [] }),
    createClient: () => ({
      realtime: {
        connect: async (_stream, options) => {
          options.onRemoteStream?.({});
          return {
            set: async () => {},
            disconnect: () => {},
            on: (name, handler) => {
              if (name === 'sessionEnded') onEnded = handler;
            },
          };
        },
      },
    }),
  });

  await session.start({
    onRemoteStream: () => {},
    onSessionEnded: (event) => reasons.push(event?.reason),
  });
  onEnded({ reason: 'insufficient_credits' });
  assert.deepEqual(reasons, ['insufficient_credits']);
  session.stop();
  onEnded({ reason: 'insufficient_credits' });
  assert.deepEqual(reasons, ['insufficient_credits']);
});

test('manual stop during the auto-stop flush does not stop twice', async () => {
  let disconnects = 0;
  const auto = [];
  const session = fakeSession({
    onDisconnect: () => {
      disconnects += 1;
    },
  });

  await session.start({
    onRemoteStream: () => {},
    onBeforeAutoStop: async () => {
      session.stop();
    },
    onAutoStop: () => auto.push('late'),
  });

  await session.scheduled[0].fn();
  assert.equal(disconnects, 1);
  assert.deepEqual(auto, []);
});

test('preferred recording mime type chooses webm before mp4', () => {
  assert.equal(
    preferredRecordingMimeType((type) => type === 'video/webm;codecs=vp9'),
    'video/webm;codecs=vp9',
  );
  assert.equal(preferredRecordingMimeType((type) => type === 'video/mp4'), 'video/mp4');
  assert.equal(preferredRecordingMimeType(undefined), 'video/webm');
});

test('recording filenames use a webm extension unless the blob is mp4', () => {
  const date = new Date(2026, 9, 17, 2, 5, 9);
  assert.equal(recordingFilename(date), 'bsdwear-tryon-20261017-020509.webm');
  assert.equal(recordingFilename(date, 'video/mp4'), 'bsdwear-tryon-20261017-020509.mp4');
});

test('mediaStreamFromVideo prefers the video element capture stream', () => {
  const captured = { id: 'captured' };
  const srcObject = { id: 'remote' };
  assert.equal(mediaStreamFromVideo({ captureStream: () => captured, srcObject }).stream, captured);
  assert.equal(mediaStreamFromVideo({ captureStream: () => captured, srcObject }).owned, true);
  assert.equal(mediaStreamFromVideo({ mozCaptureStream: () => captured, srcObject }).stream, captured);
  assert.equal(mediaStreamFromVideo({ srcObject }).stream, srcObject);
  assert.equal(mediaStreamFromVideo({ srcObject }).owned, false);
  assert.equal(mediaStreamFromVideo(null), null);
});

class FakeMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options?.mimeType || '';
    this.state = 'inactive';
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['frame'], { type: this.mimeType || 'video/webm' }) });
    this.onstop?.();
  }

  static isTypeSupported(type) {
    return type === 'video/webm';
  }
}

FakeMediaRecorder.instances = [];

test('preview recorder returns a webm blob and releases an owned capture stream', async () => {
  const trackStops = [];
  const stream = {
    id: 'capture',
    getTracks: () => [{ stop: () => trackStops.push('capture') }],
  };
  const recorder = createPreviewRecorder({
    stream,
    ownsStream: true,
    MediaRecorder: FakeMediaRecorder,
    isTypeSupported: FakeMediaRecorder.isTypeSupported,
  });

  recorder.start();
  assert.equal(FakeMediaRecorder.instances.at(-1).state, 'recording');
  const blob = await recorder.stop();
  assert.equal(blob.type, 'video/webm');
  assert.ok(blob.size > 0);
  assert.deepEqual(trackStops, ['capture']);
});

test('preview recorder refuses to start without a stream', () => {
  assert.throws(
    () => createPreviewRecorder({ stream: null, MediaRecorder: FakeMediaRecorder }),
    /没有可录制的画面/,
  );
});

test('replaySourceFromFile accepts a video file and rejects a garment image', () => {
  const source = replaySourceFromFile({ name: 'take.webm', type: 'video/webm' }, () => 'blob:take');
  assert.deepEqual(source, { url: 'blob:take', name: 'take.webm' });
  assert.throws(
    () => replaySourceFromFile({ name: 'top.png', type: 'image/png' }, () => 'blob:nope'),
    /请选择 WebM 或 MP4 视频文件/,
  );
});

test('downloadBlob saves the recording through a webm download link', () => {
  const anchors = [];
  const revoked = [];
  const doc = {
    body: { appendChild(node) { anchors.push(node); } },
    createElement() {
      return {
        click() { this.clicked = true; },
        remove() { this.removed = true; },
      };
    },
  };

  downloadBlob(new Blob(['a'], { type: 'video/webm' }), 'bsdwear-tryon-test.webm', {
    documentRef: doc,
    urlApi: {
      createObjectURL() { return 'blob:recording'; },
      revokeObjectURL(url) { revoked.push(url); },
    },
  });

  assert.equal(anchors[0].href, 'blob:recording');
  assert.equal(anchors[0].download, 'bsdwear-tryon-test.webm');
  assert.equal(anchors[0].clicked, true);
  assert.equal(anchors[0].removed, true);
  assert.deepEqual(revoked, ['blob:recording']);
});

test('showReplay plays a local file and showLiveStream returns to the camera', () => {
  const events = [];
  const video = {
    src: '',
    srcObject: { id: 'old' },
    controls: false,
    pause() { events.push('pause'); },
    load() { events.push('load'); },
    removeAttribute(name) { events.push(`remove:${name}`); this.src = ''; },
    play() { events.push('play'); return Promise.resolve(); },
  };

  showReplay(video, 'blob:take');
  assert.equal(video.srcObject, null);
  assert.equal(video.src, 'blob:take');
  assert.equal(video.controls, true);

  showLiveStream(video, { id: 'live' });
  assert.equal(video.srcObject.id, 'live');
  assert.equal(video.controls, false);
  assert.equal(video.src, '');
  assert.deepEqual(events, ['pause', 'play', 'pause', 'remove:src', 'load', 'play']);
});
