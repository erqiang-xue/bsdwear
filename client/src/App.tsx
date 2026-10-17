import { useRef, useState } from "react";
import {
  WebcamPreview,
  type WebcamPreviewHandle,
} from "./components/WebcamPreview";
import { GarmentUpload } from "./components/GarmentUpload";
import { TryOnControls } from "./components/TryOnControls";
import { requestTryOn } from "./lib/api";

export default function App() {
  const webcamRef = useRef<WebcamPreviewHandle>(null);
  const [garment, setGarment] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTryOn() {
    setError(null);
    if (!garment) {
      setError("请先上传上装");
      return;
    }
    const person = await webcamRef.current?.captureFrame();
    if (!person) {
      setError("请先开启摄像头并确保画面可见");
      return;
    }
    setLoading(true);
    try {
      const { image } = await requestTryOn(person, garment);
      setResultImage(image);
      setShowResult(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "试穿失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!resultImage) return;
    try {
      let href = resultImage;
      let revoke: string | null = null;
      if (resultImage.startsWith("http")) {
        const res = await fetch(resultImage);
        const blob = await res.blob();
        href = URL.createObjectURL(blob);
        revoke = href;
      }
      const a = document.createElement("a");
      a.href = href;
      a.download = "try-on.jpg";
      a.click();
      if (revoke) URL.revokeObjectURL(revoke);
    } catch {
      setError("下载失败，请右键另存结果图");
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>虚拟试穿</h1>
        <p className="subtitle">摄像头预览 · 上传上装 · AI 试穿</p>
      </header>
      <main className="layout">
        <section className="left">
          <WebcamPreview
            ref={webcamRef}
            resultImage={resultImage}
            showResult={showResult}
          />
        </section>
        <aside className="right">
          <GarmentUpload value={garment} onChange={setGarment} />
          <TryOnControls
            canTryOn={!!garment}
            loading={loading}
            error={error}
            hasResult={!!resultImage}
            showingResult={showResult}
            onTryOn={handleTryOn}
            onDownload={handleDownload}
            onShowCamera={() => setShowResult(false)}
          />
        </aside>
      </main>
    </div>
  );
}
