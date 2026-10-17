# Virtual Try-On Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app where the user opens a webcam, uploads a tops garment image, clicks Try-On, and sees an AI try-on result powered by FASHN.

**Architecture:** Vite + React + TypeScript frontend captures a webcam frame and garment image as data URIs, POSTs them to a same-origin Express backend at `POST /api/try-on`. The backend submits to FASHN `POST https://api.fashn.ai/v1/run` with `model_name: "tryon-max"`, polls `GET https://api.fashn.ai/v1/status/{id}` until completed/failed, and returns `{ image: string }` (CDN URL). API key stays server-side only.

**Tech Stack:** Node.js 20+, Vite 5, React 18, TypeScript, Express, `cors`, `dotenv`, Vitest (server unit tests), Playwright optional later (not required for MVP).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-17-virtual-try-on-design.md`
- Scope: webcam + upload tops only; manual Try-On click (no continuous video stream)
- Provider: FASHN Try-On Max (`tryon-max`); env `FASHN_API_KEY`
- Defaults for FASHN: `resolution: "1k"`, `generation_mode: "fast"`, `num_images: 1`, `output_format: "jpeg"`
- UI copy: Simplified Chinese
- Repo root: `/workspace/virtual-try-on`
- Do not reverse-engineer Anywear or any Chrome Web Store package

## File Structure

```
virtual-try-on/
  package.json                 # workspace scripts: concurrently client+server
  .env.example
  .gitignore
  README.md
  server/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts                 # Express listen
      app.ts                   # createApp() for tests
      routes/tryOn.ts          # POST /api/try-on
      services/fashn.ts        # runTryOn(personDataUri, garmentDataUri)
      services/fashn.test.ts
    )
  client/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx
      App.css
      components/WebcamPreview.tsx
      components/GarmentUpload.tsx
      components/TryOnControls.tsx
      lib/compressImage.ts
      lib/api.ts
```

---

### Task 1: Scaffold monorepo + Express health check

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `README.md`
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`, `server/src/app.ts`
- Test: manual curl health

**Interfaces:**
- Produces: `createApp(): Express` exporting app without listen; `GET /api/health` → `{ ok: true }`

- [ ] **Step 1: Create root and server package files**

Root `package.json`:
```json
{
  "name": "virtual-try-on",
  "private": true,
  "scripts": {
    "dev": "npm run dev --prefix server & npm run dev --prefix client",
    "dev:server": "npm run dev --prefix server",
    "dev:client": "npm run dev --prefix client",
    "test": "npm test --prefix server"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.log
.DS_Store
```

`.env.example`:
```
FASHN_API_KEY=your_fashn_api_key_here
PORT=3001
```

`server/package.json`:
```json
{
  "name": "virtual-try-on-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Implement createApp + health**

`server/src/app.ts`:
```ts
import express from "express";
import cors from "cors";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "15mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}
```

`server/src/index.ts`:
```ts
import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT) || 3001;
const app = createApp();
app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});
```

- [ ] **Step 3: Install and verify health**

```bash
cd /workspace/virtual-try-on/server && npm install
npm run start &
sleep 1
curl -s http://localhost:3001/api/health
# Expected: {"ok":true}
kill %1 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
cd /workspace/virtual-try-on
git add package.json .gitignore .env.example server
git commit -m "chore: scaffold server with health endpoint"
```

---

### Task 2: FASHN client service (unit tested)

**Files:**
- Create: `server/src/services/fashn.ts`
- Create: `server/src/services/fashn.test.ts`
- Create: `server/vitest.config.ts`

**Interfaces:**
- Produces:
  - `export type TryOnResult = { image: string }`
  - `export async function runFashnTryOn(opts: { modelImage: string; productImage: string; apiKey: string; fetchImpl?: typeof fetch }): Promise<TryOnResult>`
- Behavior: POST `/v1/run` with `tryon-max`, poll `/v1/status/{id}` every 2s, max 30 attempts (~60s). On `completed`, return `output[0]`. On `failed` or timeout, throw `Error` with readable Chinese message.

- [ ] **Step 1: Write failing tests**

`server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node" },
});
```

`server/src/services/fashn.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { runFashnTryOn } from "./fashn.js";

describe("runFashnTryOn", () => {
  it("submits run, polls until completed, returns first output URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "pred-1", error: null }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "pred-1",
            status: "processing",
            error: null,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "pred-1",
            status: "completed",
            output: ["https://cdn.fashn.ai/out.png"],
            error: null,
          }),
          { status: 200 }
        )
      );

    const result = await runFashnTryOn({
      modelImage: "data:image/jpeg;base64,AAA",
      productImage: "data:image/jpeg;base64,BBB",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    expect(result.image).toBe("https://cdn.fashn.ai/out.png");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const runCall = fetchImpl.mock.calls[0];
    expect(runCall[0]).toBe("https://api.fashn.ai/v1/run");
    expect(JSON.parse(runCall[1].body as string).model_name).toBe("tryon-max");
  });

  it("throws Chinese error when status is failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "pred-2", error: null }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "pred-2",
            status: "failed",
            error: { message: "PoseError" },
          }),
          { status: 200 }
        )
      );

    await expect(
      runFashnTryOn({
        modelImage: "data:image/jpeg;base64,AAA",
        productImage: "data:image/jpeg;base64,BBB",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow(/试穿失败/);
  });

  it("throws when API key missing", async () => {
    await expect(
      runFashnTryOn({
        modelImage: "a",
        productImage: "b",
        apiKey: "",
      })
    ).rejects.toThrow(/未配置/);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd /workspace/virtual-try-on/server && npm test
# Expected: FAIL — cannot find module ./fashn.js
```

- [ ] **Step 3: Implement fashn.ts**

```ts
export type TryOnResult = { image: string };

export type RunFashnOptions = {
  modelImage: string;
  productImage: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxPolls?: number;
};

export async function runFashnTryOn(opts: RunFashnOptions): Promise<TryOnResult> {
  const {
    modelImage,
    productImage,
    apiKey,
    fetchImpl = fetch,
    pollIntervalMs = 2000,
    maxPolls = 30,
  } = opts;

  if (!apiKey?.trim()) {
    throw new Error("未配置 FASHN_API_KEY，请在 .env 中填写后重启服务");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const runRes = await fetchImpl("https://api.fashn.ai/v1/run", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model_name: "tryon-max",
      inputs: {
        model_image: modelImage,
        product_image: productImage,
        resolution: "1k",
        generation_mode: "fast",
        num_images: 1,
        output_format: "jpeg",
      },
    }),
  });

  if (runRes.status === 401) {
    throw new Error("FASHN API Key 无效，请检查 .env 中的 FASHN_API_KEY");
  }
  if (runRes.status === 402) {
    throw new Error("FASHN 额度不足，请充值后再试");
  }
  if (!runRes.ok) {
    const text = await runRes.text();
    throw new Error(`试穿请求失败（${runRes.status}）：${text.slice(0, 200)}`);
  }

  const runData = (await runRes.json()) as { id?: string; error?: unknown };
  if (!runData.id) {
    throw new Error("试穿请求失败：未返回任务 ID");
  }

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const statusRes = await fetchImpl(
      `https://api.fashn.ai/v1/status/${runData.id}`,
      { headers }
    );
    if (!statusRes.ok) {
      throw new Error(`查询试穿状态失败（${statusRes.status}）`);
    }
    const statusData = (await statusRes.json()) as {
      status: string;
      output?: string[];
      error?: { message?: string } | string | null;
    };

    if (statusData.status === "completed") {
      const image = statusData.output?.[0];
      if (!image) throw new Error("试穿完成但未返回图片");
      return { image };
    }
    if (statusData.status === "failed") {
      const msg =
        typeof statusData.error === "string"
          ? statusData.error
          : statusData.error?.message ?? "未知错误";
      throw new Error(`试穿失败：${msg}`);
    }
    if (!["starting", "in_queue", "processing"].includes(statusData.status)) {
      throw new Error(`试穿失败：未知状态 ${statusData.status}`);
    }
  }

  throw new Error("试穿超时，请稍后重试");
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /workspace/virtual-try-on/server && npm test
# Expected: PASS (3 tests)
```

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat: add FASHN try-on client with unit tests"
```

---

### Task 3: POST /api/try-on route

**Files:**
- Create: `server/src/routes/tryOn.ts`
- Modify: `server/src/app.ts`
- Create: `server/src/routes/tryOn.test.ts`

**Interfaces:**
- Consumes: `runFashnTryOn`
- Produces: `POST /api/try-on` body `{ person: string; garment: string }` (data URIs) → `{ image: string }` or `{ error: string }` with 4xx/5xx

- [ ] **Step 1: Write route test**

```ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";

vi.mock("../services/fashn.js", () => ({
  runFashnTryOn: vi.fn(async () => ({ image: "https://cdn.example/out.jpg" })),
}));

import { runFashnTryOn } from "../services/fashn.js";

describe("POST /api/try-on", () => {
  it("returns image on success", async () => {
    process.env.FASHN_API_KEY = "k";
    const app = createApp();
    const res = await request(app)
      .post("/api/try-on")
      .send({ person: "data:image/jpeg;base64,AA", garment: "data:image/jpeg;base64,BB" });
    expect(res.status).toBe(200);
    expect(res.body.image).toBe("https://cdn.example/out.jpg");
    expect(runFashnTryOn).toHaveBeenCalled();
  });

  it("400 when missing fields", async () => {
    const app = createApp();
    const res = await request(app).post("/api/try-on").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/缺少/);
  });
});
```

- [ ] **Step 2: Run test — expect fail (route missing)**

```bash
cd /workspace/virtual-try-on/server && npm test
```

- [ ] **Step 3: Implement route and wire app**

`server/src/routes/tryOn.ts`:
```ts
import { Router } from "express";
import { runFashnTryOn } from "../services/fashn.js";

export const tryOnRouter = Router();

tryOnRouter.post("/try-on", async (req, res) => {
  const person = req.body?.person;
  const garment = req.body?.garment;
  if (typeof person !== "string" || typeof garment !== "string" || !person || !garment) {
    res.status(400).json({ error: "缺少人像或衣服图片" });
    return;
  }
  try {
    const result = await runFashnTryOn({
      modelImage: person,
      productImage: garment,
      apiKey: process.env.FASHN_API_KEY ?? "",
    });
    res.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "试穿失败";
    const status = /未配置|无效|缺少/.test(message) ? 400 : 502;
    res.status(status).json({ error: message });
  }
});
```

In `createApp()`, after health:
```ts
import { tryOnRouter } from "./routes/tryOn.js";
// ...
app.use("/api", tryOnRouter);
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /workspace/virtual-try-on/server && npm test
```

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat: add POST /api/try-on endpoint"
```

---

### Task 4: Vite React client scaffold + webcam + garment upload UI

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/tsconfig.app.json`, `client/vite.config.ts`, `client/index.html`
- Create: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/App.css`, `client/src/vite-env.d.ts`
- Create: `client/src/components/WebcamPreview.tsx`, `GarmentUpload.tsx`, `TryOnControls.tsx`
- Create: `client/src/lib/compressImage.ts`, `client/src/lib/api.ts`

**Interfaces:**
- Produces:
  - `compressImage(fileOrBlob: Blob, maxSide = 1280, quality = 0.85): Promise<string>` → JPEG data URI
  - `requestTryOn(person: string, garment: string): Promise<{ image: string }>` → `POST /api/try-on`
  - `WebcamPreview` exposes `captureFrame(): Promise<string | null>` via `forwardRef` or callback ref
- Vite proxy: `/api` → `http://localhost:3001`

- [ ] **Step 1: Scaffold client**

`client/package.json`:
```json
{
  "name": "virtual-try-on-client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

`client/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
});
```

`client/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>虚拟试穿</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Use standard Vite React TS `tsconfig` / `main.tsx` / `vite-env.d.ts`.

- [ ] **Step 2: Implement compressImage + api**

`client/src/lib/compressImage.ts`:
```ts
export async function compressImage(
  source: Blob,
  maxSide = 1280,
  quality = 0.85
): Promise<string> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法处理图片");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}
```

`client/src/lib/api.ts`:
```ts
export async function requestTryOn(
  person: string,
  garment: string
): Promise<{ image: string }> {
  const res = await fetch("/api/try-on", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person, garment }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `请求失败（${res.status}）`);
  }
  return data as { image: string };
}
```

- [ ] **Step 3: Implement UI components**

`WebcamPreview.tsx`: video element + start/stop; `captureFrame` draws video to canvas → JPEG data URI via `compressImage` path (canvas.toDataURL). Show error if `getUserMedia` fails:「无法打开摄像头，请检查权限」.

`GarmentUpload.tsx`: `<input type="file" accept="image/*">`, compress with `compressImage`, show thumbnail, call `onChange(dataUri: string | null)`.

`TryOnControls.tsx`: buttons 试穿 / 下载结果; disable 试穿 when no garment or loading; show `error` and `loading` text.

`App.tsx` layout: left preview (webcam OR result image toggle), right controls. State: `garment`, `resultImage`, `loading`, `error`. On 试穿: capture frame → `requestTryOn` → set result.

Styling in `App.css`: simple two-column layout, dark-neutral, Chinese labels.

- [ ] **Step 4: Install client and smoke-run**

```bash
cd /workspace/virtual-try-on/client && npm install
# Start server + client briefly; open http://localhost:5173 — page title 虚拟试穿, layout visible
```

- [ ] **Step 5: Write README and commit**

`README.md` must include:
1. Copy `.env.example` → `.env`, set `FASHN_API_KEY` from https://fashn.ai
2. `cd server && npm install && cd ../client && npm install`
3. Terminal A: `npm run dev --prefix server`
4. Terminal B: `npm run dev --prefix client`
5. Open http://localhost:5173
6. Note: tops only; costs FASHN credits; no API key → clear Chinese error

```bash
git add client README.md package.json
git commit -m "feat: add webcam try-on client UI"
```

---

### Task 5: End-to-end wiring polish + mock mode for demos without key

**Files:**
- Modify: `server/src/routes/tryOn.ts`, `server/src/services/fashn.ts` (only if needed)
- Modify: `client/src/App.tsx` for download + result overlay
- Modify: `.env.example`, `README.md`

**Interfaces:**
- Optional: if `FASHN_API_KEY=mock`, return the person image unchanged with a short delay so UI can be demoed without credits. Document in README.

- [ ] **Step 1: Add mock provider branch in runFashnTryOn or route**

At start of handler or service:
```ts
if (apiKey === "mock") {
  await new Promise((r) => setTimeout(r, 800));
  return { image: modelImage }; // echo person frame for UI demo
}
```

- [ ] **Step 2: Ensure download button works**

When `resultImage` set, `<a download="try-on.jpg" href={resultImage}>下载结果</a>` (if CDN URL, `fetch`→blob→object URL if cross-origin blocks download; for data URI href works directly).

- [ ] **Step 3: Manual checklist**

1. `FASHN_API_KEY=mock` → try-on returns echoed frame, UI loading/error paths OK  
2. Missing garment → button disabled or 前端提示「请先上传上装」  
3. Real key (if user provides) → real try-on  

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: mock mode and download polish for MVP"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Webcam preview | Task 4 |
| Upload tops garment | Task 4 |
| Manual Try-On | Task 4–5 |
| Thin backend + FASHN | Task 2–3 |
| Key in .env only | Task 1–3 |
| Chinese errors | Task 2–4 |
| Image compress ≤1280 | Task 4 |
| README | Task 4–5 |
| Tops only / no extension | Global constraints |

## Execution handoff

After this plan is saved, choose:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with checkpoints  
