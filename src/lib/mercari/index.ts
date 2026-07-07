import { cacheGet, cacheSet } from "../cache";
import { searchSold } from "./client";
import type { SoldSearchResult } from "./types";

export type { SoldListing, SoldSearchResult } from "./types";

const TTL_MS = 24 * 60 * 60 * 1000; // ผลค้นหา Mercari สดพอใช้ได้ 24 ชม.

export async function searchSoldCached(
  keyword: string,
): Promise<SoldSearchResult & { fromCache: boolean }> {
  const key = `mercari-sold:${keyword}`;
  const cached = cacheGet<SoldSearchResult>(key, TTL_MS);
  if (cached) return { ...cached, fromCache: true };

  const result = await searchSold(keyword);
  cacheSet(key, result);
  return { ...result, fromCache: false };
}

/** จำนวนผลขั้นต่ำที่ถือว่าคำค้น "แคบแต่ยังพอใช้ได้" สำหรับการไล่บันได */
const LADDER_MIN_LISTINGS = 5;

/**
 * ไล่ค้นจากคำเจาะจงสุด → กว้างสุด ใช้คำแรกที่ได้ผลถึงเกณฑ์
 * ถ้าไม่มีคำไหนถึงเกณฑ์เลย ใช้คำที่ได้ผลเยอะสุด
 */
export async function searchSoldLadder(
  candidates: string[],
): Promise<SoldSearchResult & { fromCache: boolean; usedKeyword: string }> {
  let best: (SoldSearchResult & { fromCache: boolean }) | null = null;
  for (const keyword of candidates) {
    const result = await searchSoldCached(keyword);
    if (result.listings.length >= LADDER_MIN_LISTINGS) {
      return { ...result, usedKeyword: keyword };
    }
    if (!best || result.listings.length > best.listings.length) best = result;
  }
  if (!best) throw new Error("ไม่มีคำค้นให้ลอง");
  return { ...best, usedKeyword: best.keyword };
}
