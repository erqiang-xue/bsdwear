import { useEffect, useRef, useState } from 'react';
import { fetchCurrentUser, logoutAccount, signIn } from './auth.js';
import { createBrowserTryOnClient, vtonModel } from './decartClient.js';
import LoginForm from './LoginForm.jsx';
import {
  DEFAULT_MAX_SESSION_SECONDS,
  MAX_SESSION_SECONDS,
  createContinuousRecorder,
  createTryOnSession,
  FRONT_CAMERA_TIP,
  clearInitLine,
  createInitLineState,
  describeAutoStop,
  describeInitStep,
  finishInitLine,
  pushInitLine,
  tickInitLine,
  describeSessionEnd,
  initStepForConnection,
  describeStartError,
  downloadBlob,
  parseMaxSeconds,
  selectTryOnRecordingStream,
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

const GARMENT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function garmentKind(file) {
  const type = (file?.type || '').toLowerCase();
  if (type === 'image/jpg' || type === 'image/jpeg') return 'image/jpeg';
  if (type === 'image/png' || type === 'image/webp') return type;
  const name = file?.name || '';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (!type) return 'image/jpeg';
  return '';
}

function fileNameFromUrl(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return name || 'garment.jpg';
  } catch {
    return 'garment.jpg';
  }
}

export default function App() {
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const startLock = useRef(false);
  const takeRecorderRef = useRef(null);
  const replayUrlRef = useRef('');
  const autoStopRef = useRef(false);
  const remoteStreamRef = useRef(null);
  const localStreamRef = useRef(null);
  const liveStartedRef = useRef(0);
  const bankedRef = useRef(0);
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('先打开摄像头。点开始试穿后才会连接试穿服务。');
  const [error, setError] = useState('');
  const [garmentName, setGarmentName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [hasRemote, setHasRemote] = useState(false);
  const [hasLocal, setHasLocal] = useState(false);
  const [maxSeconds, setMaxSeconds] = useState(DEFAULT_MAX_SESSION_SECONDS);
  const [recording, setRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [replayName, setReplayName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [garmentUrl, setGarmentUrl] = useState('');
  const [readingUrl, setReadingUrl] = useState(false);
  const [clock, setClock] = useState({ banked: 0, elapsed: 0 });
  const [initLine, setInitLine] = useState(createInitLineState);
  const [account, setAccount] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authPending, setAuthPending] = useState(false);
  const initLineRef = useRef(initLine);
  const initTimerRef = useRef(null);
  const initVisibleRef = useRef(false);
  const initRunRef = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  function takeRecorder() {
    if (!takeRecorderRef.current) takeRecorderRef.current = createContinuousRecorder();
    return takeRecorderRef.current;
  }

  function syncRecording() {
    const current = takeRecorder();
    setRecording(current.isRecording());
    setRecordingBlob(current.blob());
  }

  async function finishRecording() {
    try {
      const blob = await takeRecorder().stop();
      syncRecording();
      return blob;
    } catch (recordError) {
      syncRecording();
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
    let cancelled = false;
    fetchCurrentUser()
      .then((user) => {
        if (cancelled) return;
        setAccount(user);
        setAuthReady(true);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setAuthError(loadError?.message || '暂时无法确认登录状态，请稍后再试。');
        setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const session = createTryOnSession({
      model: vtonModel,
      createClient: () => createBrowserTryOnClient(),
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    });
    sessionRef.current = session;
    return () => {
      session.stop();
      takeRecorderRef.current?.stop?.()?.catch?.(() => {});
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

  useEffect(() => {
    if (phase !== 'live') {
      if (liveStartedRef.current) {
        const elapsed = Math.max(0, Math.floor((Date.now() - liveStartedRef.current) / 1000));
        liveStartedRef.current = 0;
        bankedRef.current += elapsed;
        setClock({ banked: bankedRef.current, elapsed: 0 });
      }
      return undefined;
    }

    const started = Date.now();
    liveStartedRef.current = started;
    const id = setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      setClock((prev) =>
        prev.elapsed === elapsed && prev.banked === bankedRef.current
          ? prev
          : { banked: bankedRef.current, elapsed },
      );
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  function attachStream(stream, { remote = false } = {}) {
    releaseReplay();
    showLiveStream(videoRef.current, stream);
    if (remote) {
      remoteStreamRef.current = stream;
      setHasRemote(true);
      void followRecording(stream);
      return;
    }
    localStreamRef.current = stream;
    setHasLocal(true);
    remoteStreamRef.current = null;
    setHasRemote(false);
    void followRecording(stream);
  }

  async function followRecording(stream) {
    try {
      await takeRecorder().follow(stream);
    } catch (recordError) {
      setError(recordError?.message || '录制失败。');
    }
  }

  function markSessionIdle() {
    remoteStreamRef.current = null;
    localStreamRef.current = null;
    setHasRemote(false);
    setHasLocal(false);
    setPhase('idle');
    const video = videoRef.current;
    if (video && !replayUrlRef.current) {
      video.srcObject = null;
      video.controls = false;
    }
  }

  async function openCameraPreview() {
    if (startLock.current || phase === 'preview' || phase === 'starting' || phase === 'live') return;
    startLock.current = true;
    setError('');
    setStatus('正在打开摄像头…');
    try {
      const stream = await sessionRef.current.openPreview({
        onLocalStream: (next) => attachStream(next),
      });
      if (!stream) {
        if (!sessionRef.current.hasLocalStream()) {
          setPhase('idle');
          setStatus('已停止。');
        }
        return;
      }
      setPhase('preview');
      setHasRemote(false);
      setStatus('摄像头已打开。点开始试穿后才会连接试穿服务。');
    } catch (cameraError) {
      setPhase('idle');
      setHasRemote(false);
      setError(describeStartError(cameraError));
      setStatus('摄像头未打开。');
    } finally {
      startLock.current = false;
    }
  }

  function commitInit(result) {
    initLineRef.current = result.state;
    setInitLine(result.state);
    if (result.state.current && phaseRef.current === 'starting') setStatus(result.state.current);
    if (result.state.mode === 'off') initVisibleRef.current = false;
    if (initTimerRef.current) window.clearTimeout(initTimerRef.current);
    initTimerRef.current = null;
    if (result.waitMs == null) return;
    const run = initRunRef.current;
    initTimerRef.current = window.setTimeout(() => {
      if (initRunRef.current !== run) return;
      commitInit(tickInitLine(initLineRef.current, Date.now()));
    }, result.waitMs);
  }

  function pushInit(step) {
    if (!initVisibleRef.current) return;
    commitInit(pushInitLine(initLineRef.current, describeInitStep(step), Date.now()));
  }

  useEffect(() => {
    if (phase === 'starting' || !initVisibleRef.current) return undefined;
    const result = phase === 'live'
      ? finishInitLine(initLineRef.current, Date.now())
      : clearInitLine(initLineRef.current, Date.now());
    commitInit(result);
    return undefined;
  }, [phase]);

  async function start() {
    if (startLock.current) return;
    startLock.current = true;
    autoStopRef.current = false;
    setError('');
    phaseRef.current = 'starting';
    initRunRef.current += 1;
    initVisibleRef.current = true;
    if (initTimerRef.current) window.clearTimeout(initTimerRef.current);
    initTimerRef.current = null;
    const fresh = createInitLineState();
    initLineRef.current = fresh;
    setInitLine(fresh);
    setPhase('starting');
    setStatus('正在准备试穿…');
    const maxDurationMs = parseMaxSeconds(maxSeconds) * 1000;
    try {
      const result = await sessionRef.current.start({
        maxDurationMs,
        onLocalStream: (stream) => attachStream(stream),
        onRemoteStream: (stream) => attachStream(stream, { remote: true }),
        onInitStep: (step) => pushInit(step),
        onQueuePosition: () => pushInit('queue'),
        onConnectionChange: (state) => {
          const step = initStepForConnection(state);
          if (step) pushInit(step);
          else if (CONNECTION_LABELS[state]) setStatus(CONNECTION_LABELS[state]);
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
      setHasRemote(false);
      if (sessionRef.current?.hasLocalStream()) {
        setPhase('preview');
        setError(describeStartError(startError));
        setStatus('试穿流未开启。摄像头仍保持打开。');
      } else {
        setPhase('idle');
        setError(describeStartError(startError));
        setStatus('试穿流未开启。');
      }
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
    setStatus('已停止，摄像头已关闭。');
  }

  async function onLogin(username, password) {
    setAuthPending(true);
    setAuthError('');
    try {
      setAccount(await signIn(username, password));
    } catch (loginError) {
      setAuthError(loginError?.message || '登录失败，请重试。');
    } finally {
      setAuthPending(false);
    }
  }

  async function logout() {
    try {
      await logoutAccount();
    } catch (logoutError) {
      setError(logoutError?.message || '退出失败，请重试。');
      return;
    }
    autoStopRef.current = false;
    await finishRecording();
    sessionRef.current?.stop();
    markSessionIdle();
    setError('');
    setStatus('先打开摄像头。点开始试穿后才会连接试穿服务。');
    setAccount(null);
  }

  async function startRecording() {
    const source = selectTryOnRecordingStream({
      localStream: localStreamRef.current,
      remoteStream: remoteStreamRef.current,
    });
    if (!source?.stream || phase === 'idle' || phase === 'replay') {
      setError('请先打开摄像头，再录制。');
      return;
    }
    try {
      const started = await takeRecorder().start(source.stream);
      syncRecording();
      if (started) setError('');
    } catch (recordError) {
      syncRecording();
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
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      setHasLocal(false);
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

  async function applyGarmentFile(file) {
    if (!file) return;
    const kind = garmentKind(file);
    if (!kind || (file.type && !GARMENT_TYPES.has(file.type.toLowerCase()) && !/\.(jpe?g|png|webp)$/i.test(file.name || ''))) {
      setError('请上传 JPEG、PNG 或 WebP 上装图片。');
      return;
    }

    const typed = file.type ? file : new File([file], file.name || 'garment.jpg', { type: kind });
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(typed);
    });
    setGarmentName(typed.name);
    setError('');

    try {
      const result = await sessionRef.current.applyGarment(typed);
      setStatus(result.applied ? '上装已更新，预览会持续变化。' : '已选择上装，开启试穿流后会自动换上。');
    } catch (applyError) {
      setError(applyError?.message || '应用上装失败。');
    }
  }

  async function onGarment(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await applyGarmentFile(file);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void applyGarmentFile(file);
  }

  async function onGarmentUrl(event) {
    event.preventDefault();
    const url = garmentUrl.trim();
    if (!url) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      setError('请输入有效的图片网址。');
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('请输入 http 或 https 图片网址。');
      return;
    }

    setReadingUrl(true);
    setError('');
    try {
      const response = await fetch(parsed.href);
      if (!response.ok) throw new Error('无法读取该图片网址。');
      const blob = await response.blob();
      const name = fileNameFromUrl(parsed.href);
      const file = new File([blob], name, { type: blob.type || '' });
      if (!garmentKind(file) || (blob.type && !GARMENT_TYPES.has(blob.type.toLowerCase()) && !/\.(jpe?g|png|webp)$/i.test(name))) {
        setError('请使用 JPEG、PNG 或 WebP 图片网址。');
        return;
      }
      await applyGarmentFile(file);
    } catch (urlError) {
      const message = urlError?.message;
      setError(!message || /failed to fetch|load failed|network/i.test(message) ? '无法读取该网址，请改用本地图片。' : message);
    } finally {
      setReadingUrl(false);
    }
  }

  const live = phase === 'live' || phase === 'starting';
  const cameraOpen = live || phase === 'preview';
  const recordSource = selectTryOnRecordingStream({
    localStream: hasLocal ? localStreamRef.current : null,
    remoteStream: hasRemote ? remoteStreamRef.current : null,
  });
  const canStartRecording = !recording && phase !== 'idle' && phase !== 'replay' && Boolean(recordSource?.stream);
  const showEmpty = phase === 'idle' && !hasRemote && !replayName;
  const limit = parseMaxSeconds(maxSeconds);
  const remaining = phase === 'live' ? Math.max(0, limit - clock.elapsed) : limit;
  const totalSeconds = clock.banked + (phase === 'live' ? clock.elapsed : 0);
  const remainPct = Math.round((remaining / limit) * 100);

  const signedIn = Boolean(account);

  return (
    <div className={`page ${signedIn ? '' : 'is-gate'}`}>
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="/bosideng-logo.png" alt="波司登 BOSIDENG" />
          <div className="brand-copy">
            <h1>实时上装试穿</h1>
          </div>
        </div>
        {signedIn ? (
          <div className="account">
            <span className="account-name">{account.username}</span>
            <button type="button" className="secondary" onClick={() => void logout()}>
              退出
            </button>
          </div>
        ) : null}
      </header>

      {!authReady ? (
        <p className="gate-status" role="status">正在进入…</p>
      ) : !signedIn ? (
        <div className="login-wrap">
          <LoginForm onSubmit={onLogin} pending={authPending} error={authError} />
        </div>
      ) : (
      <main className="studio">
        <section className={`stage ${phase === 'replay' ? 'is-replay' : ''}`} aria-label="试穿预览">
          <video ref={videoRef} autoPlay playsInline muted />
          {initLine.mode !== 'off' ? (
            <div className="danmaku" aria-hidden="true">
              <p key={`${initLine.shownAt}-${initLine.current}`} className={`danmaku-line ${initLine.mode === 'fading' ? 'is-leaving' : ''}`}>
                {initLine.current}
              </p>
            </div>
          ) : null}
          {recording ? <p className="rec-pill">录制中</p> : null}
          {showEmpty ? (
            <div className="stage-empty">
              <div className="reticle" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <i className="scan" />
              </div>
              <h2>先打开摄像头，看本地画面。</h2>
              <p>这一步只显示摄像头，不会连接试穿服务。</p>
              <button type="button" onClick={openCameraPreview} disabled={live}>
                打开摄像头
              </button>
              <p className="stage-tip">{FRONT_CAMERA_TIP}</p>
            </div>
          ) : null}
          <div className="stage-meta">
            <p className="stage-status" role="status">
              {status}
            </p>
            <p className="stage-clock">
              {phase === 'live' ? `剩余 ${remaining} 秒` : `本轮 ${limit} 秒`}
            </p>
          </div>
        </section>

        <div className="side">
        <aside className="panel">
          <div className="meter">
            <div>
              <p className="meter-label">本轮剩余</p>
              <p className="meter-sub">累计试衣 {totalSeconds} 秒</p>
            </div>
            <p className="meter-value">
              {remaining}
              <span> 秒</span>
            </p>
          </div>
          <div className="meter-track" aria-hidden="true">
            <span style={{ width: `${remainPct}%` }} />
          </div>

          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}

          <div
            className={`dropzone ${dragOver ? 'is-over' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="已选上装" />
            ) : (
              <div className="drop-placeholder" aria-hidden="true" />
            )}
            <div className="drop-copy">
              <h2>上装图片</h2>
              <p>{garmentName || '拖入图片，或从设备选择。白底、只有衣服的图效果最好。'}</p>
              <label className="file-link">
                选择上装图片
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onGarment} />
              </label>
            </div>
          </div>

          <details className="url-block">
            <summary>从网址添加上装</summary>
            <form onSubmit={onGarmentUrl}>
              <input
                type="url"
                inputMode="url"
                placeholder="https:// 图片地址"
                aria-label="上装图片网址"
                value={garmentUrl}
                onChange={(event) => setGarmentUrl(event.target.value)}
              />
              <button type="submit" className="secondary" disabled={readingUrl || !garmentUrl.trim()}>
                {readingUrl ? '读取中…' : '使用'}
              </button>
            </form>
          </details>

          <label className="duration">
            <span>本轮最长（秒）</span>
            <input
              type="number"
              min="1"
              max={MAX_SESSION_SECONDS}
              step="1"
              inputMode="numeric"
              value={maxSeconds}
              disabled={live}
              onChange={(event) => setMaxSeconds(parseMaxSeconds(event.target.value))}
            />
          </label>
          <p className="hint">默认 {DEFAULT_MAX_SESSION_SECONDS} 秒。到时自动断开试穿流并关闭摄像头。</p>
          <p className="hint">{FRONT_CAMERA_TIP}</p>

          <section className="record-block" aria-label="录制与回放">
            <h2>录制与回放</h2>
            <p className="hint">录成一条视频。试穿前开始的话，点开始试穿后会接上生成画面。</p>
            {recording ? <p className="hint">正在录制。</p> : null}
            {recordingBlob && !recording ? <p className="hint">录制已保存，可以下载或回放。</p> : null}
            {replayName ? <p className="hint">回放：{replayName}</p> : null}
            <div className="record-actions">
              <button type="button" className="secondary" onClick={startRecording} disabled={!canStartRecording}>
                开始录制
              </button>
              <button type="button" className="secondary" onClick={() => void finishRecording()} disabled={!recording}>
                停止录制
              </button>
              <button type="button" className="secondary" onClick={downloadRecording} disabled={!recordingBlob}>
                下载
              </button>
              <button type="button" className="secondary" onClick={replayRecording} disabled={!recordingBlob}>
                回放
              </button>
              <label className="file-link file-link-block">
                回放文件
                <input type="file" accept="video/webm,video/mp4,video/*" onChange={onReplayFile} />
              </label>
            </div>
          </section>
        </aside>

        <div className="dock">
          <button type="button" onClick={start} disabled={live}>
            开始试穿
          </button>
          <button type="button" className="secondary" onClick={() => void stop()} disabled={!cameraOpen}>
            停止
          </button>
        </div>
        </div>
      </main>
      )}
    </div>
  );
}
