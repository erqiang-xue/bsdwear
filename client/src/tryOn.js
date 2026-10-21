import { CSRF_COOKIE, readCookie } from './auth.js';

export const TOP_GARMENT_PROMPT = 'Substitute the current top with the garment in the reference image';

export const DEFAULT_MAX_SESSION_SECONDS = 10;
export const DEFAULT_MAX_SESSION_MS = DEFAULT_MAX_SESSION_SECONDS * 1000;
export const MAX_SESSION_SECONDS = 120;

const RECORDING_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export function parseMaxSeconds(value, fallback = DEFAULT_MAX_SESSION_SECONDS) {
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(MAX_SESSION_SECONDS, Math.max(1, Math.round(numeric)));
}

export function describeAutoStop(maxDurationMs = DEFAULT_MAX_SESSION_MS) {
  const seconds = Math.max(1, Math.round(maxDurationMs / 1000));
  if (maxDurationMs === DEFAULT_MAX_SESSION_MS) {
    return `已自动停止（默认最长 ${seconds} 秒）`;
  }
  return `已自动停止（最长 ${seconds} 秒）`;
}

export function preferredRecordingMimeType(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return 'video/webm';
  return RECORDING_MIME_CANDIDATES.find((type) => isTypeSupported(type)) || 'video/webm';
}

export function extensionForMime(mimeType) {
  return typeof mimeType === 'string' && mimeType.includes('mp4') ? 'mp4' : 'webm';
}

export function recordingFilename(date = new Date(), mimeType = 'video/webm') {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join('-');
  return `bodideng-tryon-${stamp}.${extensionForMime(mimeType)}`;
}

export function mediaStreamFromVideo(video) {
  if (!video) return null;
  if (typeof video.captureStream === 'function') {
    return { stream: video.captureStream(), owned: true };
  }
  if (typeof video.mozCaptureStream === 'function') {
    return { stream: video.mozCaptureStream(), owned: true };
  }
  return { stream: video.srcObject ?? null, owned: false };
}

function liveVideoTracks(stream) {
  const tracks = stream?.getVideoTracks?.() ?? [];
  return tracks.filter((track) => track && track.readyState !== 'ended');
}

// Which live picture to draw next. video.captureStream() cannot be the
// recording itself: Chrome keeps it on the first srcObject, and MediaRecorder
// cannot change streams. The take is one canvas.captureStream(); this only
// picks the frame source that canvas paints.
export function selectTryOnRecordingStream({ remoteStream, localStream } = {}) {
  if (liveVideoTracks(remoteStream).length > 0) {
    return { stream: remoteStream, owned: false, source: 'remote', stage: 'after' };
  }
  if (liveVideoTracks(localStream).length > 0) {
    return { stream: localStream, owned: false, source: 'local', stage: 'before' };
  }
  return null;
}

export function replaySourceFromFile(file, createObjectURL = URL.createObjectURL.bind(URL)) {
  if (!file) return null;
  const type = typeof file.type === 'string' ? file.type : '';
  const name = typeof file.name === 'string' && file.name ? file.name : '录制文件';
  const videoFile = type.startsWith('video/') || /\.(webm|mp4|mov|mkv)$/i.test(name);
  if (!videoFile) throw new Error('请选择 WebM 或 MP4 视频文件。');
  return { url: createObjectURL(file), name };
}

export function downloadBlob(blob, filename, { documentRef = globalThis.document, urlApi = globalThis.URL } = {}) {
  const url = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  urlApi.revokeObjectURL(url);
}

export function showReplay(video, url) {
  if (!video || !url) return;
  video.pause?.();
  video.srcObject = null;
  video.src = url;
  video.controls = true;
  const playback = video.play?.();
  playback?.catch?.(() => {});
}

export function showLiveStream(video, stream) {
  if (!video) return;
  video.pause?.();
  video.controls = false;
  if (typeof video.removeAttribute === 'function') video.removeAttribute('src');
  else video.src = '';
  video.load?.();
  video.srcObject = stream;
  const playback = video.play?.();
  playback?.catch?.(() => {});
}

// lucy-vton-latest publishes 1280×720 (16:9). Asking the phone front camera
// for that frame crops the sensor and cuts off the torso. A soft 4:3 ideal
// at or below 720p keeps shoulders through the waist, and nothing is exact.
export const FRONT_CAMERA_IDEAL_WIDTH = 960;
export const FRONT_CAMERA_IDEAL_HEIGHT = 720;
export const FRONT_CAMERA_MAX_EDGE = 1280;
export const FRONT_CAMERA_ASPECT = 4 / 3;
export const TRY_ON_MIRROR = true;
export const FRONT_CAMERA_TIP = '请退后半步，让肩膀到腰入镜。';

export function frameRateConstraint(fps) {
  if (typeof fps === 'number' && Number.isFinite(fps)) return { ideal: fps };
  if (fps == null || typeof fps !== 'object') return undefined;
  const ideal = fps.ideal ?? fps.max ?? fps.exact ?? fps.min;
  if (typeof ideal !== 'number') return undefined;
  const range = { ideal };
  if (typeof fps.max === 'number') range.max = fps.max;
  return range;
}

export function cameraConstraints(model) {
  const video = {
    facingMode: { ideal: 'user' },
    resizeMode: { ideal: 'none' },
    aspectRatio: { ideal: FRONT_CAMERA_ASPECT },
    width: { ideal: FRONT_CAMERA_IDEAL_WIDTH, max: FRONT_CAMERA_MAX_EDGE },
    height: { ideal: FRONT_CAMERA_IDEAL_HEIGHT, max: FRONT_CAMERA_MAX_EDGE },
  };
  const frameRate = frameRateConstraint(model?.fps);
  if (frameRate) video.frameRate = frameRate;
  return { audio: false, video };
}

export function relaxedCameraConstraints() {
  return { audio: false, video: { facingMode: { ideal: 'user' } } };
}

export function garmentState(image) {
  return {
    prompt: TOP_GARMENT_PROMPT,
    image,
    enhance: true,
  };
}

export async function fetchRealtimeApiKey(fetchImpl = globalThis.fetch, options = {}) {
  const cookie = options.cookie ?? (typeof document === 'undefined' ? '' : document.cookie || '');
  const headers = { Accept: 'application/json' };
  const csrf = readCookie(cookie, CSRF_COOKIE);
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let response;
  try {
    response = await fetchImpl('/api/realtime-token', {
      method: 'POST',
      credentials: 'include',
      headers,
    });
  } catch {
    throw new Error('无法连接试穿服务，请确认后端已启动。');
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok || typeof body.apiKey !== 'string' || body.apiKey.length === 0) {
    throw new Error(body.error || '获取试穿令牌失败。');
  }
  return body.apiKey;
}

export function createTryOnDecartClient(createDecartClient, fetchImpl) {
  return createDecartClient({
    apiKeyProvider: async () => fetchRealtimeApiKey(fetchImpl),
  });
}

export function describeStartError(error) {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return '无法使用摄像头：请在浏览器中允许摄像头权限后重试。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '未检测到摄像头。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '摄像头被其他程序占用，请关闭后重试。';
  }
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return '开启试穿流失败。';
}

export const INIT_LINE_HOLD_MS = 1100;
export const INIT_LINE_FADE_MS = 520;

export function describeInitStep(step) {
  switch (step) {
    case 'camera-opening':
      return '正在打开摄像头…';
    case 'camera-ready':
    case 'model':
    case 'output':
    case 'token':
      return '正在准备试穿…';
    case 'connecting':
    case 'channel':
    case 'connected':
      return '正在连线…';
    case 'queue':
      return '请稍等，前面还有人…';
    case 'garment':
      return '正在换上衣服…';
    case 'generating':
    case 'ready':
      return '马上好了…';
    case 'reconnecting':
      return '正在重新连线…';
    default:
      return '';
  }
}

export function initStepForConnection(state) {
  if (state === 'connecting') return 'channel';
  if (state === 'connected') return 'connected';
  if (state === 'generating') return 'generating';
  if (state === 'reconnecting') return 'reconnecting';
  if (state === 'disconnected') return 'disconnected';
  return '';
}

export function createInitLineState() {
  return { queue: [], current: '', mode: 'off', shownAt: 0, fadingAt: 0, closing: false };
}

function queueInitText(state, text) {
  if (!text || state.current === text || state.queue.at(-1) === text) return state;
  return { ...state, queue: [...state.queue, text] };
}

function advanceInitLine(state, now) {
  if (state.mode === 'fading') {
    const left = INIT_LINE_FADE_MS - (now - state.fadingAt);
    if (left > 0) return { state, waitMs: left };
    state = { ...state, current: '', mode: 'off' };
  }

  if (state.mode === 'visible') {
    const more = state.queue.length > 0;
    if (!more && !state.closing) return { state, waitMs: null };
    const held = now - state.shownAt;
    if (held < INIT_LINE_HOLD_MS) return { state, waitMs: INIT_LINE_HOLD_MS - held };
    return {
      state: { ...state, mode: 'fading', fadingAt: now },
      waitMs: INIT_LINE_FADE_MS,
    };
  }

  if (state.queue.length === 0) return { state, waitMs: null };
  const [current, ...queue] = state.queue;
  const next = { ...state, queue, current, mode: 'visible', shownAt: now, fadingAt: 0 };
  const shouldLeave = queue.length > 0 || next.closing;
  return { state: next, waitMs: shouldLeave ? INIT_LINE_HOLD_MS : null };
}

export function pushInitLine(state, text, now) {
  return advanceInitLine(queueInitText(state, text), now);
}

export function tickInitLine(state, now) {
  return advanceInitLine(state, now);
}

export function finishInitLine(state, now) {
  if (state.closing) return advanceInitLine(state, now);
  return advanceInitLine({ ...state, closing: true }, now);
}

export function clearInitLine(state, now) {
  if (!state.current) return { state: createInitLineState(), waitMs: null };
  return {
    state: {
      queue: [],
      current: state.current,
      mode: 'fading',
      shownAt: state.shownAt,
      fadingAt: now,
      closing: true,
    },
    waitMs: INIT_LINE_FADE_MS,
  };
}

export function describeSessionEnd(reason) {
  if (reason === 'insufficient_credits') return '试穿额度已用完，请到 platform.decart.ai 查看余额。';
  if (reason === 'moderation_violation') return '画面未通过内容审核，试穿已结束。';
  if (reason === 'policy_violation') return '连接被拒绝，请检查令牌权限。';
  if (reason === 'session_limit') return '已达到同时会话上限，请先停止其他试穿。';
  return '试穿流已结束。';
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    track.stop();
  }
}

export function createPreviewRecorder({
  stream,
  ownsStream = false,
  MediaRecorder: MediaRecorderImpl = globalThis.MediaRecorder,
  isTypeSupported,
} = {}) {
  if (!stream) throw new Error('没有可录制的画面。');
  if (typeof MediaRecorderImpl !== 'function') throw new Error('当前浏览器不支持录制。');

  const mimeType = preferredRecordingMimeType(
    isTypeSupported ?? MediaRecorderImpl.isTypeSupported?.bind(MediaRecorderImpl),
  );
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorderImpl(stream, { mimeType });
  } catch {
    recorder = new MediaRecorderImpl(stream);
  }

  recorder.ondataavailable = (event) => {
    if (event?.data && event.data.size > 0) chunks.push(event.data);
  };

  function blobType() {
    return recorder.mimeType || mimeType || 'video/webm';
  }

  function buildBlob() {
    if (ownsStream) stopTracks(stream);
    return new Blob(chunks, { type: blobType() });
  }

  return {
    mimeType: blobType(),
    start() {
      if (recorder.state === 'inactive') recorder.start();
    },
    stop() {
      if (recorder.state === 'inactive') return Promise.resolve(buildBlob());
      return new Promise((resolve, reject) => {
        recorder.onstop = () => resolve(buildBlob());
        recorder.onerror = (event) => reject(event?.error || new Error('录制失败。'));
        recorder.stop();
      });
    },
  };
}

export const RECORDING_WIDTH = 720;
export const RECORDING_HEIGHT = 960;
export const RECORDING_FPS = 30;

export function paintRecordingFrame(ctx, video, width, height) {
  const frameWidth = video?.videoWidth || 0;
  const frameHeight = video?.videoHeight || 0;
  if (!ctx || frameWidth < 1 || frameHeight < 1 || !(video.readyState >= 2)) return false;
  const scale = Math.min(width / frameWidth, height / frameHeight);
  const dw = frameWidth * scale;
  const dh = frameHeight * scale;
  ctx.fillStyle = '#05080c';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
  return true;
}

function browserCanvas() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('当前浏览器不支持录制。');
  }
  return document.createElement('canvas');
}

function browserVideo() {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  return video;
}

async function showRecordingSource(video, stream) {
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  if (!(video.readyState >= 2) || !(video.videoWidth > 0)) {
    await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        video.removeEventListener?.('loadeddata', finish);
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      video.addEventListener?.('loadeddata', finish, { once: true });
    });
  }
  try {
    await video.play?.();
  } catch {
    // The element can still paint frames after a rejected autoplay.
  }
}

// One MediaRecorder, bound to a canvas capture stream for the whole take.
// Swapping the hidden video's srcObject from the camera to the Decart stream
// changes what the canvas paints. The recorder never sees those streams, so
// Chrome's video.captureStream latch does not apply.
export function createContinuousRecorder({
  MediaRecorder: MediaRecorderImpl,
  isTypeSupported,
  createCanvas = browserCanvas,
  createVideo = browserVideo,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis)
    || ((callback) => setTimeout(() => callback(Date.now()), 16)),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) || clearTimeout,
  width = RECORDING_WIDTH,
  height = RECORDING_HEIGHT,
  fps = RECORDING_FPS,
} = {}) {
  let recorder = null;
  let canvas = null;
  let canvasStream = null;
  let video = null;
  let sourceStream = null;
  let ctx = null;
  let frameId = null;
  let running = false;
  let blob = null;
  let tail = Promise.resolve();

  function enqueue(task) {
    const run = tail.then(task, task);
    tail = run.then(() => {}, () => {});
    return run;
  }

  function draw() {
    if (!running || !ctx || !video) return;
    paintRecordingFrame(ctx, video, canvas.width, canvas.height);
    frameId = requestFrame(draw);
  }

  return {
    isRecording() {
      return running;
    },
    blob() {
      return blob;
    },
    source() {
      return sourceStream;
    },
    start(stream) {
      return enqueue(async () => {
        if (running) return false;
        if (liveVideoTracks(stream).length === 0) throw new Error('没有可录制的画面。');
        canvas = createCanvas();
        canvas.width = width;
        canvas.height = height;
        if (typeof canvas.captureStream !== 'function') throw new Error('当前浏览器不支持录制。');
        ctx = canvas.getContext('2d');
        canvasStream = canvas.captureStream(fps);
        video = createVideo();
        await showRecordingSource(video, stream);
        sourceStream = stream;
        running = true;
        draw();
        try {
          recorder = createPreviewRecorder({
            stream: canvasStream,
            ownsStream: true,
            MediaRecorder: MediaRecorderImpl,
            isTypeSupported,
          });
          recorder.start();
        } catch (error) {
          running = false;
          if (frameId != null) cancelFrame(frameId);
          frameId = null;
          stopTracks(canvasStream);
          throw error;
        }
        blob = null;
        return true;
      });
    },
    follow(stream) {
      return enqueue(async () => {
        if (!running || !video || !stream || stream === sourceStream) return false;
        if (liveVideoTracks(stream).length === 0) return false;
        sourceStream = stream;
        await showRecordingSource(video, stream);
        return true;
      });
    },
    stop() {
      return enqueue(async () => {
        if (!recorder) return blob;
        running = false;
        if (frameId != null) cancelFrame(frameId);
        frameId = null;
        sourceStream = null;
        if (video) video.srcObject = null;
        video = null;
        const current = recorder;
        recorder = null;
        const next = await current.stop();
        blob = next?.size > 0 ? next : null;
        return blob;
      });
    },
  };
}

async function openCamera(getUserMedia, model) {
  try {
    return await getUserMedia(cameraConstraints(model));
  } catch (error) {
    if (error?.name !== 'OverconstrainedError') throw error;
    return getUserMedia(relaxedCameraConstraints());
  }
}

export function createTryOnSession({
  createClient,
  getUserMedia,
  model,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancelSchedule = (id) => clearTimeout(id),
}) {
  let generation = 0;
  let starting = false;
  let realtimeClient = null;
  let localStream = null;
  let garment = null;
  let setTail = Promise.resolve();
  let timerId = null;
  let suppressRemoteEnd = false;
  let openingPreview = false;

  function clearAutoStop() {
    if (timerId == null) return;
    cancelSchedule(timerId);
    timerId = null;
  }

  function armAutoStop(sessionId, rt, maxDurationMs, onBeforeAutoStop, onAutoStop) {
    clearAutoStop();
    if (!(maxDurationMs > 0)) return;
    timerId = schedule(() => {
      timerId = null;
      return (async () => {
        if (sessionId !== generation || realtimeClient !== rt) return;
        try {
          await onBeforeAutoStop?.();
        } catch {
          // Saving a recording is best-effort. The billed session still ends.
        }
        if (sessionId !== generation || realtimeClient !== rt) return;
        stop();
        onAutoStop?.({ maxDurationMs });
      })();
    }, maxDurationMs);
  }

  async function pushGarment(rt) {
    const image = garment;
    if (!rt || image == null || realtimeClient !== rt) return false;
    await rt.set(garmentState(image));
    return true;
  }

  function enqueueGarment(rt) {
    const job = setTail.then(() => pushGarment(rt));
    setTail = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  function stop() {
    clearAutoStop();
    generation += 1;
    starting = false;
    suppressRemoteEnd = true;
    const rt = realtimeClient;
    const stream = localStream;
    realtimeClient = null;
    localStream = null;
    rt?.disconnect();
    stopTracks(stream);
  }

  return {
    hasLocalStream() {
      return localStream != null;
    },

    async openPreview({ onLocalStream } = {}) {
      if (realtimeClient || starting) {
        throw new Error('试穿流已经开启。');
      }
      if (localStream) {
        onLocalStream?.(localStream);
        return localStream;
      }
      if (openingPreview) return null;

      openingPreview = true;
      const sessionId = generation;
      try {
        const stream = await openCamera(getUserMedia, model);
        if (sessionId !== generation) {
          stopTracks(stream);
          return null;
        }
        localStream = stream;
        onLocalStream?.(stream);
        return stream;
      } finally {
        openingPreview = false;
      }
    },

    async start({
      onLocalStream,
      onRemoteStream,
      onConnectionChange,
      onError,
      onSessionEnded,
      onAutoStop,
      onBeforeAutoStop,
      onInitStep,
      onQueuePosition,
      maxDurationMs = DEFAULT_MAX_SESSION_MS,
    } = {}) {
      if (realtimeClient || starting) {
        throw new Error('试穿流已经开启。');
      }

      starting = true;
      suppressRemoteEnd = false;
      const sessionId = generation;
      let stream = localStream;
      try {
        if (!stream) {
          onInitStep?.('camera-opening');
          stream = await openCamera(getUserMedia, model);
          if (sessionId !== generation) {
            stopTracks(stream);
            return null;
          }
          localStream = stream;
          onInitStep?.('camera-ready');
        } else {
          onInitStep?.('camera-ready');
        }
        onLocalStream?.(stream);
        if (model?.name) onInitStep?.('model', { model: model.name });
        if (model?.width && model?.height) onInitStep?.('output', { width: model.width, height: model.height });
        onInitStep?.('token');
        onInitStep?.('connecting');

        const client = createClient();
        const options = {
          model,
          mirror: TRY_ON_MIRROR,
          onRemoteStream,
        };
        if (onConnectionChange) options.onConnectionChange = onConnectionChange;
        if (onQueuePosition) options.onQueuePosition = onQueuePosition;

        const rt = await client.realtime.connect(stream, options);
        if (sessionId !== generation) {
          rt.disconnect();
          return null;
        }

        if (onError) rt.on('error', onError);
        if (onSessionEnded) {
          rt.on('sessionEnded', (event) => {
            if (suppressRemoteEnd) return;
            onSessionEnded(event);
          });
        }

        realtimeClient = rt;
        localStream = stream;
        armAutoStop(sessionId, rt, maxDurationMs, onBeforeAutoStop, onAutoStop);
        if (garment) {
          onInitStep?.('garment');
          await enqueueGarment(rt);
        }
        if (sessionId !== generation) return null;
        onInitStep?.('ready');
        return rt;
      } catch (error) {
        if (sessionId !== generation) return null;
        if (realtimeClient) stop();
        throw error;
      } finally {
        if (sessionId === generation) starting = false;
      }
    },

    async applyGarment(file) {
      garment = file;
      const rt = realtimeClient;
      if (!rt) return { applied: false };
      try {
        await enqueueGarment(rt);
      } catch (error) {
        if (!realtimeClient) return { applied: false };
        throw error;
      }
      return { applied: realtimeClient != null };
    },

    stop,
  };
}
