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
