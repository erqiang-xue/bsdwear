import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { loadEnvFile } from './loadEnv.js';

loadEnvFile();

const app = createApp();
if (app.locals.authSeeded) {
  console.log(`已创建初始账号 ${app.locals.authSeeded}`);
}
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`bodideng server http://127.0.0.1:${port}`);
});
