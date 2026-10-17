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

  it("mock mode echoes model image after short delay", async () => {
    const result = await runFashnTryOn({
      modelImage: "data:image/jpeg;base64,PERSON",
      productImage: "data:image/jpeg;base64,GARMENT",
      apiKey: "mock",
    });
    expect(result.image).toBe("data:image/jpeg;base64,PERSON");
  });
