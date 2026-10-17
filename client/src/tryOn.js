export const TOP_GARMENT_PROMPT = 'Substitute the current top with the garment in the reference image';

export function cameraConstraints(model) {
  const video = { facingMode: 'user' };
  if (model?.fps != null) video.frameRate = model.fps;
  if (model?.width != null) video.width = model.width;
  if (model?.height != null) video.height = model.height;
  return { audio: false, video };
}

export function garmentState(image) {
  return {
    prompt: TOP_GARMENT_PROMPT,
    image,
    enhance: true,
  };
}

export async function fetchRealtimeApiKey(fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl('/api/realtime-token', { method: 'POST' });
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

async function openCamera(getUserMedia, model) {
  try {
    return await getUserMedia(cameraConstraints(model));
  } catch (error) {
    if (error?.name !== 'OverconstrainedError') throw error;
    return getUserMedia({ audio: false, video: { facingMode: 'user' } });
  }
}

export function createTryOnSession({ createClient, getUserMedia, model }) {
  let generation = 0;
  let starting = false;
  let realtimeClient = null;
  let localStream = null;
  let garment = null;
  let setTail = Promise.resolve();

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

  return {
    async start({ onLocalStream, onRemoteStream, onConnectionChange, onError, onSessionEnded } = {}) {
      if (realtimeClient || starting) {
        throw new Error('试穿流已经开启。');
      }

      starting = true;
      const sessionId = generation;
      let stream;
      try {
        stream = await openCamera(getUserMedia, model);
        if (sessionId !== generation) {
          stopTracks(stream);
          return null;
        }

        onLocalStream?.(stream);

        const client = createClient();
        const options = {
          model,
          mirror: 'auto',
          onRemoteStream,
        };
        if (onConnectionChange) options.onConnectionChange = onConnectionChange;

        const rt = await client.realtime.connect(stream, options);
        if (sessionId !== generation) {
          rt.disconnect();
          stopTracks(stream);
          return null;
        }

        if (onError) rt.on('error', onError);
        if (onSessionEnded) rt.on('sessionEnded', onSessionEnded);

        realtimeClient = rt;
        localStream = stream;
        if (garment) await enqueueGarment(rt);
        if (sessionId !== generation) return null;
        return rt;
      } catch (error) {
        if (sessionId !== generation) return null;
        realtimeClient?.disconnect();
        realtimeClient = null;
        localStream = null;
        stopTracks(stream);
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

    stop() {
      generation += 1;
      starting = false;
      const rt = realtimeClient;
      const stream = localStream;
      realtimeClient = null;
      localStream = null;
      rt?.disconnect();
      stopTracks(stream);
    },
  };
}
