type Props = {
  canTryOn: boolean;
  loading: boolean;
  error: string | null;
  hasResult: boolean;
  onTryOn: () => void;
  onDownload: () => void;
  onShowCamera: () => void;
  showingResult: boolean;
};

export function TryOnControls({
  canTryOn,
  loading,
  error,
  hasResult,
  onTryOn,
  onDownload,
  onShowCamera,
  showingResult,
}: Props) {
  return (
    <div className="tryon-controls">
      <h3>试穿</h3>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!canTryOn || loading}
        onClick={onTryOn}
      >
        {loading ? "试穿中…" : "试穿"}
      </button>
      {loading ? <p className="loading-text">正在生成试穿效果，请稍候…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {hasResult ? (
        <div className="result-actions">
          <button type="button" className="btn" onClick={onDownload}>
            下载结果
          </button>
          {showingResult ? (
            <button type="button" className="btn btn-secondary" onClick={onShowCamera}>
              返回预览
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
