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
