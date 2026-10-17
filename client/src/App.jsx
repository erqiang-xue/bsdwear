import { useEffect, useRef, useState } from 'react';
import { createBrowserTryOnClient, vtonModel } from './decartClient.js';
import {
  createTryOnSession,
  describeSessionEnd,
  describeStartError,
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
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('点击开启摄像头，开始试穿流。');
  const [error, setError] = useState('');
  const [garmentName, setGarmentName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [hasRemote, setHasRemote] = useState(false);

  useEffect(() => {
    const session = createTryOnSession({
      model: vtonModel,
      createClient: () => createBrowserTryOnClient(),
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    });
    sessionRef.current = session;
    return () => {
      session.stop();
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function attachStream(stream, { remote = false } = {}) {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (remote) setHasRemote(true);
    video.play().catch(() => {});
  }

  async function start() {
    if (startLock.current) return;
    startLock.current = true;
    setError('');
    setPhase('starting');
    setStatus('正在打开摄像头…');
    try {
      const result = await sessionRef.current.start({
        onLocalStream: (stream) => attachStream(stream),
        onRemoteStream: (stream) => attachStream(stream, { remote: true }),
        onConnectionChange: (state) => {
          if (CONNECTION_LABELS[state]) setStatus(CONNECTION_LABELS[state]);
        },
        onError: (event) => {
          setError(event?.message || '试穿流连接出错。');
        },
        onSessionEnded: (event) => {
          setError(describeSessionEnd(event?.reason));
          setPhase('idle');
          setHasRemote(false);
          sessionRef.current?.stop();
        },
      });
      if (!result) {
        setPhase('idle');
        setStatus('已停止。');
        return;
      }
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

  function stop() {
    sessionRef.current?.stop();
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setHasRemote(false);
    setPhase('idle');
    setError('');
    setStatus('已停止。');
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
        <p className="cost">标准模式约 $0.02/秒，停止后不再计费。</p>
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
