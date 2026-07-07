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
