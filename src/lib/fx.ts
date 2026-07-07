// อัตราแลกเปลี่ยน JPY→THB — ดึงวันละครั้ง cache ใน SQLite
import { cacheGet, cacheSet } from "./cache";

const FX_URL = "https://open.er-api.com/v6/latest/JPY";
const TTL_MS = 24 * 60 * 60 * 1000;

export async function getJpyThbRate(): Promise<number | null> {
  const cached = cacheGet<number>("fx:jpy-thb", TTL_MS);
  if (cached) return cached;

  try {
    const res = await fetch(FX_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { rates?: { THB?: number } };
    const rate = data.rates?.THB;
    if (!rate) throw new Error("no THB rate in response");
    cacheSet("fx:jpy-thb", rate);
    return rate;
  } catch {
    // ดึงไม่ได้ → ใช้ค่าเก่าเกิน TTL ถ้ามี, ไม่มีเลยคืน null (UI ซ่อนบาท)
    return cacheGet<number>("fx:jpy-thb", Number.MAX_SAFE_INTEGER);
  }
}
