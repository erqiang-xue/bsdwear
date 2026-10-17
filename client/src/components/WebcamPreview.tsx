import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type WebcamPreviewHandle = {
  captureFrame: () => Promise<string | null>;
  isActive: () => boolean;
};

type Props = {
  resultImage: string | null;
  showResult: boolean;
};

export const WebcamPreview = forwardRef<WebcamPreviewHandle, Props>(
  function WebcamPreview({ resultImage, showResult }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [active, setActive] = useState(false);
    const [camError, setCamError] = useState<string | null>(null);

    const stopCamera = useCallback(() => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setActive(false);
    }, []);

    const startCamera = useCallback(async () => {
      setCamError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setActive(true);
      } catch {
        setCamError("无法打开摄像头，请检查权限");
        setActive(false);
      }
    }, []);

    useEffect(() => {
      return () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        isActive: () => active,
        captureFrame: async () => {
          const video = videoRef.current;
          if (!video || !active || video.videoWidth === 0) return null;
          const maxSide = 1280;
          const scale = Math.min(
            1,
            maxSide / Math.max(video.videoWidth, video.videoHeight)
          );
          const w = Math.round(video.videoWidth * scale);
          const h = Math.round(video.videoHeight * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(video, 0, 0, w, h);
          return canvas.toDataURL("image/jpeg", 0.85);
        },
      }),
      [active]
    );

    return (
      <div className="preview-wrap">
        <div className="preview-stage">
          <video
            ref={videoRef}
            className="preview-video"
            playsInline
            muted
            style={{ display: showResult && resultImage ? "none" : "block" }}
          />
          {showResult && resultImage ? (
            <img className="preview-result" src={resultImage} alt="试穿结果" />
          ) : null}
          {!active && !(showResult && resultImage) ? (
            <div className="preview-placeholder">摄像头未开启</div>
          ) : null}
        </div>
        {camError ? <p className="error-text">{camError}</p> : null}
        <div className="preview-actions">
          {!active ? (
            <button type="button" className="btn" onClick={startCamera}>
              开启摄像头
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={stopCamera}>
              关闭摄像头
            </button>
          )}
        </div>
      </div>
    );
  }
);
