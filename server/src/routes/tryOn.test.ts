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
