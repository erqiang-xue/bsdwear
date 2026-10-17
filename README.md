# bsdwear

Webcam virtual try-on for tops. The page keeps a live camera preview and continuously dresses the person with Decart Lucy VTON (`lucy-vton-latest`). Uploading a new top updates the same stream; it does not reconnect.

The interface is in Chinese.

## Run it

1. Create an API key at [platform.decart.ai](https://platform.decart.ai). New accounts get free trial credits.
2. Copy the example env file and set the key in the repository root:

   ```bash
   cp .env.example .env
   ```

   `DECART_API_KEY` is the permanent `dct_*` key. It stays on the server. The browser only receives a short-lived client token from `POST /api/realtime-token`.

3. Install and start both processes:

   ```bash
   npm install
   npm run dev
   ```

4. Open http://localhost:5173 . Allow the camera, choose **开启摄像头 · 开始试穿流**, then **上传上装**. **停止** disconnects the stream and turns the camera off.

The try-on stream stops itself after **10 seconds** by default (about $0.20). Change **最长时长（秒）** before starting; the default stays 10. When the timer ends, the page disconnects Decart, stops the camera, and shows **已自动停止（默认最长 10 秒）**. **停止** cancels that timer.

While the preview is live, **开始录制** / **停止录制** capture the video element as WebM (MP4 only if the browser cannot record WebM). **下载** saves that file. **回放本次录制** plays it back locally, and **回放文件** plays a video you choose from disk. Replay does not open a Decart session.

`GET /api/health` returns `{ "ok": true }`.

To serve the built client from Express:

```bash
npm run build
npm start
```

That listens on port 3001 (override with `PORT`).

## Cost

Lucy VTON realtime in standard mode is about **$0.02 per second** of active generation at 720p. This app does not pass `speed: "fast"` (that mode is about $0.04 per second). Each session auto-stops after 10 seconds unless you set another duration, and **停止** ends it sooner. See [Decart pricing](https://docs.platform.decart.ai/getting-started/pricing).

## How the token stays off the page

`server/` loads `DECART_API_KEY` from the root `.env`, then:

```js
createDecartClient({ apiKey: process.env.DECART_API_KEY }).tokens.create()
```

The response is `{ "apiKey": "<short-lived token>" }`. If the key is missing, the endpoint returns a Chinese error and does not call Decart.

The client builds its SDK client with `apiKeyProvider`, so a new token is minted for each connect and reconnect:

```js
createDecartClient({
  apiKeyProvider: async () => {
    const res = await fetch('/api/realtime-token', { method: 'POST' });
    const { apiKey } = await res.json();
    return apiKey;
  },
});
```

The camera uses the model's `fps`, `width`, and `height` when the SDK provides them. After connect, a garment upload calls:

```js
realtimeClient.set({
  prompt: 'Substitute the current top with the garment in the reference image',
  image: file,
  enhance: true,
});
```

A plain product photo of the top (JPEG, PNG, or WebP, no person in frame) works best.

## Tests

```bash
npm test
```

Server tests cover health, the token endpoint, and the missing-key error. They inject a fake Decart client, so they do not spend credits.

## Legacy

Single-image try-on through FASHN (`POST /api/try-on`) is not part of this app. Live preview uses Decart Lucy VTON only.
