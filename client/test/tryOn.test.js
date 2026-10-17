import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MAX_SESSION_MS,
  TOP_GARMENT_PROMPT,
  cameraConstraints,
  createContinuousRecorder,
  createPreviewRecorder,
  paintRecordingFrame,
  createTryOnDecartClient,
  createTryOnSession,
  clearInitLine,
  createInitLineState,
  describeAutoStop,
  describeInitStep,
  finishInitLine,
  INIT_LINE_FADE_MS,
  INIT_LINE_HOLD_MS,
  pushInitLine,
  tickInitLine,
  describeStartError,
  initStepForConnection,
  downloadBlob,
  fetchRealtimeApiKey,
  mediaStreamFromVideo,
  selectTryOnRecordingStream,
  parseMaxSeconds,
  preferredRecordingMimeType,
  recordingFilename,
  replaySourceFromFile,
  showLiveStream,
  showReplay,
} from '../src/tryOn.js';

test('camera constraints keep a soft 4:3 front-camera frame instead of the model size', () => {
  const { video } = cameraConstraints({ fps: 24, width: 1280, height: 720 });

  assert.deepEqual(video.facingMode, { ideal: 'user' });
  assert.deepEqual(video.resizeMode, { ideal: 'none' });
  assert.equal(video.aspectRatio.ideal, 4 / 3);
  assert.deepEqual(video.width, { ideal: 960, max: 1280 });
  assert.deepEqual(video.height, { ideal: 720, max: 1280 });
  assert.deepEqual(video.frameRate, { ideal: 24 });
  assert.equal(video.width.exact, undefined);
  assert.equal(video.height.exact, undefined);
  assert.notEqual(video.width.ideal, 1280);
  assert.ok(video.aspectRatio.ideal < 1280 / 720);
});

test('camera constraints stay valid when the model omits capture hints', () => {
  for (const model of [{}, undefined]) {
    const { audio, video } = cameraConstraints(model);
    assert.equal(audio, false);
    assert.deepEqual(video.facingMode, { ideal: 'user' });
    assert.equal(video.frameRate, undefined);
    assert.equal(video.width.exact, undefined);
    assert.equal(video.height.exact, undefined);
  }
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

test('init lines use plain Chinese and hide technical details', () => {
  const jargon = /模型|令牌|输出|1280|720|分辨率|通道|会话|API|WebRTC|摄像头已就绪/;
  const samples = [
    ['camera-opening', '正在打开摄像头…'],
    ['camera-ready', '正在准备试穿…'],
    ['model', '正在准备试穿…'],
    ['output', '正在准备试穿…'],
    ['token', '正在准备试穿…'],
    ['connecting', '正在连线…'],
    ['channel', '正在连线…'],
    ['queue', '请稍等，前面还有人…'],
    ['garment', '正在换上衣服…'],
    ['ready', '马上好了…'],
    ['generating', '马上好了…'],
    ['reconnecting', '正在重新连线…'],
  ];
  for (const [step, text] of samples) {
    const line = describeInitStep(step, { model: 'lucy-vton-latest', width: 1280, height: 720, position: 3 });
    assert.equal(line, text);
    assert.equal(jargon.test(line), false);
  }
  assert.equal(describeInitStep('nope'), '');
  assert.equal(initStepForConnection('connecting'), 'channel');
  assert.equal(initStepForConnection('generating'), 'generating');
  assert.equal(initStepForConnection('idle'), '');
});

test('init lines appear one at a time and the finished line fades before the next', () => {
  let state = createInitLineState();
  let now = 0;
  for (const step of ['camera-opening', 'model', 'output', 'token', 'connecting', 'garment', 'ready']) {
    state = pushInitLine(state, describeInitStep(step), now).state;
  }
  assert.equal(state.current, '正在打开摄像头…');
  assert.equal(state.mode, 'visible');
  assert.deepEqual(state.queue, ['正在准备试穿…', '正在连线…', '正在换上衣服…', '马上好了…']);

  state = tickInitLine(state, INIT_LINE_HOLD_MS).state;
  assert.equal(state.mode, 'fading');
  assert.equal(state.current, '正在打开摄像头…');

  state = tickInitLine(state, INIT_LINE_HOLD_MS + INIT_LINE_FADE_MS).state;
  assert.equal(state.current, '正在准备试穿…');
  assert.equal(state.mode, 'visible');
  assert.equal(state.queue[0], '正在连线…');
});

test('start reports camera, model, token, and a waiting garment before ready', async () => {
  const steps = [];
  const session = createTryOnSession({
    model: { name: 'lucy-vton-latest', width: 1280, height: 720, fps: 30 },
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    createClient: () => ({
      realtime: {
        connect: async (_stream, options) => {
          options.onConnectionChange?.('connecting');
          options.onQueuePosition?.({ position: 2, queueSize: 4 });
          return { set: async () => {}, disconnect() {}, on() {} };
        },
      },
    }),
  });

  await session.applyGarment({ name: 'coat.png' });
  await session.start({
    onRemoteStream() {},
    onInitStep: (step, detail) => steps.push([step, detail?.model ?? detail?.width ?? detail?.position ?? null]),
  });

  assert.deepEqual(steps, [
    ['camera-opening', null],
    ['camera-ready', null],
    ['model', 'lucy-vton-latest'],
    ['output', 1280],
    ['token', null],
    ['connecting', null],
    ['garment', null],
    ['ready', null],
  ]);
  session.stop();
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
  assert.equal(connects[0].mirror, true);
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
  assert.deepEqual(calls[1], { audio: false, video: { facingMode: { ideal: 'user' } } });
  session.stop();
});

test('connect failure keeps the camera until stop', async () => {
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
  assert.deepEqual(stopped, []);
  assert.equal(session.hasLocalStream(), true);
  session.stop();
  assert.deepEqual(stopped, ['cam']);
  assert.equal(session.hasLocalStream(), false);
});

test('opening the camera does not create a try-on client', async () => {
  let created = 0;
  const seen = [];
  const session = createTryOnSession({
    model: {},
    getUserMedia: async () => ({ id: 'cam', getTracks: () => [] }),
    createClient: () => {
      created += 1;
      return {};
    },
  });

  const stream = await session.openPreview({ onLocalStream: (next) => seen.push(next) });
  assert.equal(stream.id, 'cam');
  assert.equal(seen.length, 1);
  assert.equal(created, 0);
  session.stop();
});

test('start reuses an open camera and connects only then', async () => {
  let mediaCalls = 0;
  const stream = { id: 'cam', getTracks: () => [] };
  let connected = null;
  let clients = 0;
  const session = createTryOnSession({
    model: { name: 'lucy-vton-latest' },
    getUserMedia: async () => {
      mediaCalls += 1;
      return stream;
    },
    createClient: () => {
      clients += 1;
      return {
        realtime: {
          connect: async (got, options) => {
            connected = got;
            options.onRemoteStream({ id: 'remote' });
            return { set: async () => {}, disconnect: () => {}, on: () => {} };
          },
        },
      };
    },
  });

  await session.openPreview();
  assert.equal(mediaCalls, 1);
  assert.equal(clients, 0);
  await session.start({ onRemoteStream: () => {} });
  assert.equal(mediaCalls, 1);
  assert.equal(clients, 1);
  assert.equal(connected, stream);
  session.stop();
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
  assert.equal(recordingFilename(date), 'bodideng-tryon-20261017-020509.webm');
  assert.equal(recordingFilename(date, 'video/mp4'), 'bodideng-tryon-20261017-020509.mp4');
});

test('try-on recording uses the remote AI stream even if the video element still captures the camera', () => {
  const localCamera = { id: 'local-camera' };
  const remote = {
    id: 'decart-remote',
    getVideoTracks: () => [{ kind: 'video', readyState: 'live' }],
  };
  const chosen = selectTryOnRecordingStream({ remoteStream: remote, localStream: localCamera });
  assert.equal(chosen.stream, remote);
  assert.equal(chosen.source, 'remote');
  assert.equal(chosen.stage, 'after');
  assert.equal(chosen.owned, false);
  assert.notEqual(chosen.stream, localCamera);
  assert.equal(selectTryOnRecordingStream({ remoteStream: null }), null);
  assert.equal(selectTryOnRecordingStream({ remoteStream: { getVideoTracks: () => [] } }), null);
  assert.equal(
    selectTryOnRecordingStream({
      remoteStream: { getVideoTracks: () => [{ kind: 'video', readyState: 'ended' }] },
    }),
    null,
  );
});

test('camera-only recording uses the local MediaStream and never video.captureStream()', () => {
  let captures = 0;
  const local = {
    id: 'local-camera',
    getVideoTracks: () => [{ kind: 'video', readyState: 'live' }],
  };
  const video = {
    captureStream() {
      captures += 1;
      return { id: 'latched-camera' };
    },
  };
  const chosen = selectTryOnRecordingStream({ localStream: local, video });
  assert.equal(chosen.stream, local);
  assert.equal(chosen.source, 'local');
  assert.equal(chosen.stage, 'before');
  assert.equal(chosen.owned, false);
  assert.equal(captures, 0);
  assert.equal(selectTryOnRecordingStream({ localStream: { getVideoTracks: () => [] } }), null);
  assert.equal(
    selectTryOnRecordingStream({
      localStream: { getVideoTracks: () => [{ kind: 'video', readyState: 'ended' }] },
    }),
    null,
  );
});

test('paintRecordingFrame keeps the last picture until the next frame is ready', () => {
  const calls = [];
  const ctx = {
    fillStyle: '',
    fillRect(...args) { calls.push(['fill', this.fillStyle, ...args]); },
    drawImage(...args) { calls.push(['draw', ...args]); },
  };
  const frame = { videoWidth: 160, videoHeight: 90, readyState: 2 };
  assert.equal(paintRecordingFrame(ctx, frame, 100, 100), true);
  assert.equal(calls[0][0], 'fill');
  assert.equal(calls[1][0], 'draw');
  assert.equal(calls[1][1], frame);
  assert.equal(calls[1][2], 0);
  assert.ok(calls[1][3] > 0);
  assert.equal(paintRecordingFrame(ctx, { videoWidth: 0, videoHeight: 0, readyState: 0 }, 100, 100), false);
  assert.equal(calls.filter((call) => call[0] === 'fill').length, 1);
});

test('a recording that starts on the camera and follows try-on stays one canvas blob', async () => {
  FakeMediaRecorder.instances = [];
  const stopped = [];
  const videoCaptures = [];
  const local = {
    id: 'local-camera',
    getVideoTracks: () => [{ kind: 'video', readyState: 'live' }],
    getTracks: () => [{ stop: () => stopped.push('local') }],
    captureStream() { videoCaptures.push('local'); },
  };
  const remote = {
    id: 'decart-remote',
    getVideoTracks: () => [{ kind: 'video', readyState: 'live' }],
    getTracks: () => [{ stop: () => stopped.push('remote') }],
    captureStream() { videoCaptures.push('remote'); },
  };
  const draws = [];
  const canvasStops = [];
  let scheduled = null;
  const video = {
    srcObject: null,
    videoWidth: 320,
    videoHeight: 240,
    readyState: 2,
    play() { return Promise.resolve(); },
    captureStream() { videoCaptures.push('element'); return { id: 'latched' }; },
  };
  const canvas = {
    width: 0,
    height: 0,
    captureStream(fps) {
      return {
        id: 'canvas-stream',
        fps,
        getTracks: () => [{ stop: () => canvasStops.push('canvas') }],
      };
    },
    getContext() {
      return {
        fillRect() {},
        drawImage(source) { draws.push(source); },
      };
    },
  };
  const take = createContinuousRecorder({
    MediaRecorder: FakeMediaRecorder,
    isTypeSupported: FakeMediaRecorder.isTypeSupported,
    createCanvas: () => canvas,
    createVideo: () => video,
    requestFrame(callback) { scheduled = callback; return 1; },
    cancelFrame() { scheduled = null; },
  });

  await take.start(local);
  assert.equal(FakeMediaRecorder.instances.length, 1);
  assert.equal(FakeMediaRecorder.instances[0].stream.id, 'canvas-stream');
  assert.equal(FakeMediaRecorder.instances[0].state, 'recording');
  assert.equal(video.srcObject, local);
  assert.equal(draws.at(-1), video);

  const followed = await take.follow(remote);
  assert.equal(followed, true);
  assert.equal(FakeMediaRecorder.instances.length, 1);
  assert.equal(FakeMediaRecorder.instances[0].state, 'recording');
  assert.equal(video.srcObject, remote);
  scheduled?.();
  assert.equal(draws.at(-1), video);
  assert.notEqual(FakeMediaRecorder.instances[0].stream, local);
  assert.notEqual(FakeMediaRecorder.instances[0].stream, remote);

  const blob = await take.stop();
  assert.equal(take.isRecording(), false);
  assert.equal(blob, take.blob());
  assert.equal(blob.type, 'video/webm');
  assert.ok(blob.size > 0);
  assert.deepEqual(videoCaptures, []);
  assert.deepEqual(stopped, []);
  assert.deepEqual(canvasStops, ['canvas']);
  assert.equal(await take.follow(remote), false);
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

  downloadBlob(new Blob(['a'], { type: 'video/webm' }), 'bodideng-tryon-test.webm', {
    documentRef: doc,
    urlApi: {
      createObjectURL() { return 'blob:recording'; },
      revokeObjectURL(url) { revoked.push(url); },
    },
  });

  assert.equal(anchors[0].href, 'blob:recording');
  assert.equal(anchors[0].download, 'bodideng-tryon-test.webm');
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
