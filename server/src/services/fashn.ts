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

  if (apiKey === "mock") {
    await new Promise((r) => setTimeout(r, 800));
    return { image: modelImage };
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
