import { useRef, useState } from "react";
import { compressImage } from "../lib/compressImage";

type Props = {
  value: string | null;
  onChange: (dataUri: string | null) => void;
};

export function GarmentUpload({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const dataUri = await compressImage(file);
      onChange(dataUri);
    } catch {
      setError("图片处理失败，请换一张再试");
      onChange(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="garment-upload">
      <h3>上装图片</h3>
      <p className="hint">支持 T 恤、衬衫、外套（第一版仅上装）</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "处理中…" : value ? "更换上装" : "上传上装"}
      </button>
      {value ? (
        <div className="garment-thumb-wrap">
          <img className="garment-thumb" src={value} alt="上装预览" />
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            清除
          </button>
        </div>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
