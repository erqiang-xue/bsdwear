import express from "express";
import cors from "cors";
import { tryOnRouter } from "./routes/tryOn.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "15mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api", tryOnRouter);
  return app;
}
