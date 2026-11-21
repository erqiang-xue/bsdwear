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

## User Center login

Identity can move to the shared User Center. Try-on sessions, garments, and the local account rows stay in this app. The switch is `USER_CENTER_ENABLED`. It defaults to off. While it is off, the username and password form is unchanged, and `GET /auth/oauth/start` returns `USER_CENTER_DISABLED`.

Turn it on and an unsigned visitor is sent to the User Center hosted login page. This app uses the authorization code flow with S256 PKCE. `client_id` defaults to `bsdwear`. There is no client secret, and this app does not send a password or a password hash. The browser returns to `/auth/oauth/callback`. The server exchanges the code at `POST /oauth/token`, reads `GET /oauth/userinfo`, and sets the same `bw_session` and `bw_csrf` cookies. Try-on still calls `POST /api/realtime-token` with those cookies.

The User Center client is already seeded as a public PKCE client with `allow_self_register=false` and `require_password=false`. Do not change that policy. Because self-registration is off, a phone that does not already exist in User Center is rejected there (`SELF_REGISTER_DISABLED`, “该应用未开放自助注册”). This app does not add a public signup page or an SMS login. `require_password=false` means User Center does not demand a password before it issues the code for this client. This app does not add a way around that, and it does not start sending a client secret.

Local password login and `POST /api/auth/password` return `USER_CENTER_REQUIRED` while the flag is on. Logout still only revokes the bsdwear session and clears `bw_session` and `bw_csrf`. It does not call User Center, so a User Center session can remain.

### Run it against a local User Center

User Center is a separate repository. This repository does not change it. In that repo, with the demo SMS provider (the code is printed only in the User Center log):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 43123
```

`ENV=development` and `SMS_PROVIDER=demo`. The hosted login page is http://127.0.0.1:43123/login .

In this repo's `.env`:

```bash
USER_CENTER_ENABLED=true
USER_CENTER_BASE_URL=http://127.0.0.1:43123
USER_CENTER_CLIENT_ID=bsdwear
USER_CENTER_PUBLIC_URL=http://127.0.0.1:5173
```

Then `npm install` and `npm run dev`, and open http://127.0.0.1:5173 . Vite proxies `/auth` to the API and keeps the browser host, so the callback stays on port 5173. `npm start` serves the built client from the API on port 3001; set `USER_CENTER_PUBLIC_URL=http://127.0.0.1:3001` for that.

The callback path is `/auth/oauth/callback`. While the public URL is a loopback origin, this app will use:

- http://127.0.0.1:5173/auth/oauth/callback
- http://localhost:5173/auth/oauth/callback
- http://127.0.0.1:3001/auth/oauth/callback
- http://localhost:3001/auth/oauth/callback

`config/clients.json` in User Center currently lists only its own demo callback for `bsdwear`. Register the callbacks above on the User Center process, not in this repo, with `OAUTH_EXTRA_REDIRECT_URIS`. That value is a JSON object:

```text
OAUTH_EXTRA_REDIRECT_URIS={"bsdwear":["http://127.0.0.1:5173/auth/oauth/callback","http://localhost:5173/auth/oauth/callback","http://127.0.0.1:3001/auth/oauth/callback","http://localhost:3001/auth/oauth/callback"]}
```

More callbacks this app should accept can be added, comma-separated, in `USER_CENTER_EXTRA_REDIRECT_URIS`. Each one also has to be registered on User Center. Do not commit a production origin into the User Center repository.

The known production front door, for later registration only, is https://wear.erqiang.cn . The callback path there would be `/auth/oauth/callback` (https://wear.erqiang.cn/auth/oauth/callback). It is not a default and it is not required for the local demo. When that host is used, set `USER_CENTER_PUBLIC_URL` in the deployment environment and add the same URL to User Center's `OAUTH_EXTRA_REDIRECT_URIS` under `bsdwear`. Keep `SameSite=lax` (the default). `strict` drops the short-lived `bw_oauth` cookie on the way back from User Center.

### Linking an existing try-on account

Nothing is copied automatically, and a User Center login does not create a try-on user. Passwords stay where they are. This app never sends `password_hash` to User Center.

Match order, after User Center has already authenticated someone:

1. `users.center_user_id`, the User Center `user_id` (`sub`). A later login keeps that row even if the username or phone in the profile is different.
2. Otherwise the unique username (`preferred_username`), compared without case. A username match wins over a different person's phone. The two rows are not merged.
3. Otherwise, if the profile has a phone, the normalized mainland mobile (`1` then a digit `3-9` then 9 digits, with `+86`, `0086`, spaces, and hyphens removed). It matches a stored `phone` or a username that is exactly that number, and only when exactly one local user matches.

If the matched row is already linked to a different `user_id`, the callback stops with `IDENTITY_CONFLICT` and does not rebind. If nothing matches, the callback stops with `ACCOUNT_NOT_LINKED` and does not insert a user. A User Center `userinfo` of 401, or a profile without a UUID `sub`, does not open a session.

To let an existing try-on user in, an administrator creates that person in User Center first. Use the same username, the same mainland phone, or both. Do not paste the bsdwear password hash. User Center hashes passwords itself. `POST /api/v1/admin/users` with header `X-Admin-Token` (User Center's `ADMIN_API_TOKEN`, or an access token for a User Center admin):

```bash
curl -H 'Content-Type: application/json' -H 'X-Admin-Token: <user-center-admin-token>' \
  -d '{"username":"staff01","phone":"13800138000"}' \
  http://127.0.0.1:43123/api/v1/admin/users
```

The local try-on row must already exist (`AUTH_SEED`, or `POST /api/auth/users` by a signed-in admin). That local password cannot be used to sign in while `USER_CENTER_ENABLED=true`. There is no public registration on either side for this client.

`user_center_links` records `legacy_app=bsdwear` and the local user id next to the User Center `user_id`.

| Route | Who can call it |
| --- | --- |
| `POST /api/auth/login` | Anyone, while User Center login is off. `USER_CENTER_REQUIRED` when it is on |
| `GET /api/auth/config` | Anyone. `{ "userCenterEnabled": false }` unless the flag is on |
| `GET /auth/oauth/start` | Redirects to User Center when the flag is on. 404 `USER_CENTER_DISABLED` when it is off |
| `GET /auth/oauth/callback` | Sets `bw_session` and `bw_csrf` after a User Center login. 404 when the flag is off |
| `GET /api/auth/me` | Signed-in user, otherwise 401 |
| `POST /api/auth/logout` | Signed-in user, then the session is revoked |
| `POST /api/auth/password` | Signed-in user, while User Center login is off |
| `POST /api/auth/users` | Admin. Creates a local try-on account. It is not a public signup |
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

Server tests cover health, the token endpoint, the missing-key error, login, logout, and the rule that a try-on token requires a session. They also cover User Center login with the flag off and on, including PKCE, account linking, and the refusal to create or merge users. They inject a fake Decart client and a fake User Center, so they do not spend credits and do not call a real User Center.

## Legacy

Single-image try-on through FASHN (`POST /api/try-on`) is not part of this app. Live preview uses Decart Lucy VTON only.
