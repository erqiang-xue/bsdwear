# bodideng

Webcam virtual try-on for tops. The page keeps a live camera preview and continuously dresses the person with Decart Lucy VTON (`lucy-vton-latest`). Uploading a new top updates the same stream; it does not reconnect.

The interface is in Chinese.

## Run it

1. Create an API key at [platform.decart.ai](https://platform.decart.ai). New accounts get free trial credits.
2. Copy the example env file and set the key in the repository root:

   ```bash
   cp .env.example .env
   ```

   `DECART_API_KEY` is the permanent `dct_*` key. It stays on the server. The browser only receives a short-lived client token from `POST /api/realtime-token`.

3. Install and start both processes. Node.js 22.13 or newer is required (Node 26 is fine). Account data uses Node's built-in SQLite, so `npm install` does not compile a native module and does not need Visual Studio.

   ```bash
   npm install
   npm run dev
   ```

4. Create the first account, then open http://localhost:5173 . The camera and try-on controls stay hidden until login. **打开摄像头** shows the local camera and does not call Decart. **开始试穿** is what connects the try-on stream. Add a top by dropping a file, choosing **选择上装图片**, or pasting an image URL. **停止** disconnects the stream and turns the camera off.

On a phone the preview stacks above the controls as a tall 3:4 stage, and **开始试穿** / **停止** stay in a bar at the bottom of the screen. Wider windows keep the preview on the left and the controls on the right.

The try-on stream stops itself after **10 seconds** by default. Change **本轮最长（秒）** before **开始试穿**; the default stays 10. Opening the camera does not start that timer. When the timer ends, the page disconnects Decart, stops the camera, and shows **已自动停止（默认最长 10 秒）**. **停止** cancels that timer.

**开始录制** saves one video. With only the camera open, that video is the local preview. If **开始试穿** connects while recording is still running, the same file continues and the picture changes to the Decart try-on. Starting the recording after try-on is already on screen records only the generated picture. The recorder is attached to a canvas, and the canvas paints whichever live frame is current, because `video.captureStream()` stays on the first stream and a MediaRecorder cannot switch inputs. **下载** and **回放** use that one file. **回放文件** plays a video you choose from disk. Replay does not open a Decart session. Files are WebM, or MP4 only if the browser cannot record WebM.

`GET /api/health` returns `{ "ok": true }` and does not require login.

## Accounts

Try-on uses its own user list in a SQLite file (`data/auth.sqlite` by default, `AUTH_DB_PATH` to move it). The file is opened with Node's built-in `node:sqlite` module, not a native addon, so Windows does not need the Visual Studio C++ build tools. It does not call Precisio and does not share that database. Passwords are stored as PBKDF2-HMAC-SHA256 hashes (200,000 iterations and a random salt). Login sets an opaque cookie (`bw_session`, HttpOnly) and stores only the SHA-256 of that value. A separate readable cookie (`bw_csrf`) is required on later changes. The session lasts 7 days (`SESSION_DAYS`) and is revoked on logout. There is no self-registration, refresh token, or bearer token.

Nothing is seeded unless you turn it on. To create the first admin, set these in the root `.env` and start the server. The password must be at least 8 characters. If that username already exists, startup leaves the password alone.

```bash
AUTH_SEED=1
AUTH_SEED_USERNAME=demo
AUTH_SEED_PASSWORD=choose-a-password
```

The server prints `已创建初始账号 demo` once. Turn `AUTH_SEED` off after that. An admin can add another account while logged in:

```bash
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"choose-a-password"}' \
  http://127.0.0.1:3001/api/auth/login

# Copy the bw_csrf cookie value into the header.
curl -b cookies.txt -H 'Content-Type: application/json' -H 'X-CSRF-Token: <csrf>' \
  -d '{"username":"staff01","password":"another-password"}' \
  http://127.0.0.1:3001/api/auth/users
```

Change your own password with `POST /api/auth/password` and `{ "currentPassword", "newPassword" }`. That signs every session out.

Login is a username (a phone-style id is fine) and a password. The page shows try-on only after `GET /api/auth/me` succeeds. Logout clears the cookies. Every change except login sends `X-CSRF-Token` matching `bw_csrf`.

| Route | Who can call it |
| --- | --- |
| `POST /api/auth/login` | Anyone |
| `GET /api/auth/me` | Signed-in user, otherwise 401 |
| `POST /api/auth/logout` | Signed-in user, then the session is revoked |
| `POST /api/auth/password` | Signed-in user |
| `POST /api/auth/users` | Admin |
| `POST /api/realtime-token` | Signed-in user. This is what starts a try-on stream |
| `GET /api/health` | Anyone |

The page shows the current username and **退出**. Ordinary copy stays in Chinese and does not mention cookies or tokens.

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

The camera does not copy Lucy VTON's 1280×720 frame. That 16:9 size makes phone front cameras crop the torso. Capture uses a soft 4:3 ideal (960×720, max edge 1280), `facingMode: { ideal: 'user' }`, and `resizeMode: { ideal: 'none' }`. The published stream is mirrored (`mirror: true`) so the selfie matches the person even when the browser does not report `facingMode`. On a narrow screen the preview is a tall 3:4 stage. After connect, a garment upload calls:

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

Server tests cover health, the token endpoint, the missing-key error, login, logout, and the rule that a try-on token requires a session. They inject a fake Decart client, so they do not spend credits.

## Legacy

Single-image try-on through FASHN (`POST /api/try-on`) is not part of this app. Live preview uses Decart Lucy VTON only.
