import { useEffect, useRef, useState } from 'react';
import { createBrowserTryOnClient, vtonModel } from './decartClient.js';
import {
  DEFAULT_MAX_SESSION_SECONDS,
  MAX_SESSION_SECONDS,
  createPreviewRecorder,
  createTryOnSession,
  FRONT_CAMERA_TIP,
  describeAutoStop,
  describeSessionEnd,
  describeStartError,
  downloadBlob,
  mediaStreamFromVideo,
  parseMaxSeconds,
  recordingFilename,
  replaySourceFromFile,
  showLiveStream,
  showReplay,
} from './tryOn.js';

const CONNECTION_LABELS = {
  connecting: '正在连接试穿流…',
  connected: '试穿流已连接',
  generating: '正在生成试穿画面',
  reconnecting: '正在重新连接试穿流…',
  disconnected: '试穿流已断开',
};

export default function App() {
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const startLock = useRef(false);
  const recorderRef = useRef(null);
  const replayUrlRef = useRef('');
  const autoStopRef = useRef(false);
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('点击开启摄像头，开始试穿流。');
  const [error, setError] = useState('');
  const [garmentName, setGarmentName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [hasRemote, setHasRemote] = useState(false);
  const [maxSeconds, setMaxSeconds] = useState(DEFAULT_MAX_SESSION_SECONDS);
  const [recording, setRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [replayName, setReplayName] = useState('');

  async function finishRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return null;
    recorderRef.current = null;
    setRecording(false);
    try {
      const blob = await recorder.stop();
      if (blob?.size > 0) setRecordingBlob(blob);
      return blob;
    } catch (recordError) {
      setError(recordError?.message || '录制失败。');
      return null;
    }
  }

  function releaseReplay() {
    if (!replayUrlRef.current) return;
    URL.revokeObjectURL(replayUrlRef.current);
    replayUrlRef.current = '';
    setReplayName('');
  }

  useEffect(() => {
    const session = createTryOnSession({
      model: vtonModel,
      createClient: () => createBrowserTryOnClient(),
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    });
    sessionRef.current = session;
    return () => {
      session.stop();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      recorder?.stop?.()?.catch?.(() => {});
      const video = videoRef.current;
      if (video) video.srcObject = null;
      if (replayUrlRef.current) {
        URL.revokeObjectURL(replayUrlRef.current);
        replayUrlRef.current = '';
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function attachStream(stream, { remote = false } = {}) {
    releaseReplay();
    showLiveStream(videoRef.current, stream);
    if (remote) setHasRemote(true);
  }

  function markSessionIdle() {
    setHasRemote(false);
    setPhase('idle');
    const video = videoRef.current;
    if (video && !replayUrlRef.current) {
      video.srcObject = null;
      video.controls = false;
    }
  }

  async function start() {
    if (startLock.current) return;
    startLock.current = true;
    autoStopRef.current = false;
    setError('');
    setPhase('starting');
    setStatus('正在打开摄像头…');
    const maxDurationMs = parseMaxSeconds(maxSeconds) * 1000;
    try {
      const result = await sessionRef.current.start({
        maxDurationMs,
        onLocalStream: (stream) => attachStream(stream),
        onRemoteStream: (stream) => attachStream(stream, { remote: true }),
        onConnectionChange: (state) => {
          if (CONNECTION_LABELS[state]) setStatus(CONNECTION_LABELS[state]);
        },
        onError: (event) => {
          setError(event?.message || '试穿流连接出错。');
        },
        onBeforeAutoStop: () => finishRecording(),
        onAutoStop: ({ maxDurationMs: limit }) => {
          autoStopRef.current = true;
          markSessionIdle();
          setError('');
          setStatus(describeAutoStop(limit));
        },
        onSessionEnded: (event) => {
          void finishRecording();
          setError(describeSessionEnd(event?.reason));
          markSessionIdle();
          sessionRef.current?.stop();
        },
      });
      if (!result) {
        setPhase('idle');
        if (!autoStopRef.current) setStatus('已停止。');
        return;
      }
      if (autoStopRef.current) return;
      setPhase('live');
      setStatus('试穿流已连接。上传上装后会直接换装，无需重新连接。');
    } catch (startError) {
      if (startError?.message === '试穿流已经开启。') return;
      setPhase('idle');
      setHasRemote(false);
      setError(describeStartError(startError));
      setStatus('试穿流未开启。');
    } finally {
      startLock.current = false;
    }
  }

  async function stop() {
    autoStopRef.current = false;
    await finishRecording();
    sessionRef.current?.stop();
    markSessionIdle();
    setError('');
    setStatus('已停止。');
  }

  async function startRecording() {
    if (recorderRef.current) return;
    const source = mediaStreamFromVideo(videoRef.current);
    if (!source?.stream) {
      setError('没有可录制的画面。');
      return;
    }
    try {
      const recorder = createPreviewRecorder({ stream: source.stream, ownsStream: source.owned });
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setError('');
    } catch (recordError) {
      setError(recordError?.message || '当前浏览器不支持录制。');
    }
  }

  function downloadRecording() {
    if (!recordingBlob) return;
    downloadBlob(recordingBlob, recordingFilename(new Date(), recordingBlob.type || 'video/webm'));
  }

  function playReplay(source) {
    void (async () => {
      await finishRecording();
      sessionRef.current?.stop();
      if (replayUrlRef.current && replayUrlRef.current !== source.url) {
        URL.revokeObjectURL(replayUrlRef.current);
      }
      replayUrlRef.current = source.url;
      setReplayName(source.name);
      setHasRemote(false);
      setPhase('replay');
      setError('');
      setStatus('正在回放本地文件。');
      showReplay(videoRef.current, source.url);
    })();
  }

  function onReplayFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      playReplay(replaySourceFromFile(file));
    } catch (replayError) {
      setError(replayError?.message || '无法回放该文件。');
    }
  }

  function replayRecording() {
    if (!recordingBlob) return;
    const name = recordingFilename(new Date(), recordingBlob.type || 'video/webm');
    try {
      playReplay(replaySourceFromFile(new File([recordingBlob], name, { type: recordingBlob.type || 'video/webm' })));
    } catch (replayError) {
      setError(replayError?.message || '无法回放该文件。');
    }
  }

  async function onGarment(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('请上传 JPEG、PNG 或 WebP 上装图片。');
      return;
    }

    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setGarmentName(file.name);
    setError('');

    try {
      const result = await sessionRef.current.applyGarment(file);
      setStatus(result.applied ? '上装已更新，预览会持续变化。' : '已选择上装，开启试穿流后会自动换上。');
    } catch (applyError) {
      setError(applyError?.message || '应用上装失败。');
    }
  }

  const live = phase === 'live' || phase === 'starting';

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="mark">bsdwear</p>
          <h1>实时上装试穿</h1>
        </div>
        <p className="cost">标准模式约 $0.02/秒。默认最长 10 秒，停止后不再计费。</p>
      </header>

      <main className="studio">
        <section className="stage" aria-label="试穿预览">
          <video ref={videoRef} autoPlay playsInline muted />
          {phase === 'idle' && !hasRemote ? (
            <div className="stage-empty">
              <p>摄像头画面会在这里变成持续的试穿预览。</p>
              <p>先打开摄像头，再上传一件上装。</p>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <p className="status" role="status">
            {status}
          </p>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {recording ? <p className="hint">正在录制试穿画面。</p> : null}
          {recordingBlob && !recording ? <p className="hint">录制已保存，可以下载或回放。</p> : null}
          {replayName ? <p className="hint">回放：{replayName}</p> : null}

          <label className="duration">
            最长时长（秒）
            <input
              type="number"
              min="1"
              max={MAX_SESSION_SECONDS}
              step="1"
              inputMode="numeric"
              aria-label="最长时长（秒）"
              value={maxSeconds}
              disabled={live}
              onChange={(event) => setMaxSeconds(parseMaxSeconds(event.target.value))}
            />
          </label>
          <p className="hint">到时自动断开试穿流并关闭摄像头。</p>
          <p className="hint">{FRONT_CAMERA_TIP}</p>

          <div className="actions">
            <button type="button" onClick={start} disabled={live}>
              开启摄像头 · 开始试穿流
            </button>
            <button type="button" className="secondary" onClick={stop} disabled={!live}>
              停止
            </button>
            <label className="upload">
              上传上装
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onGarment}
              />
            </label>
          </div>

          <div className="actions record-actions">
            <button type="button" onClick={startRecording} disabled={!live || recording}>
              开始录制
            </button>
            <button type="button" className="secondary" onClick={() => void finishRecording()} disabled={!recording}>
              停止录制
            </button>
            <button type="button" className="secondary" onClick={downloadRecording} disabled={!recordingBlob}>
              下载
            </button>
            {recordingBlob ? (
              <button type="button" className="secondary" onClick={replayRecording}>
                回放本次录制
              </button>
            ) : null}
            <label className="upload">
              回放文件
              <input type="file" accept="video/webm,video/mp4,video/*" onChange={onReplayFile} />
            </label>
          </div>

          <div className="garment">
            {previewUrl ? <img src={previewUrl} alt="已选上装" /> : <div className="garment-empty">尚未选择上装</div>}
            <div>
              <h2>上装</h2>
              <p>{garmentName || '白底、只有衣服的图片效果最好。换装不用重新连接。'}</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
