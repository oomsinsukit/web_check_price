// AI re-rank — เทียบรูปของผู้ใช้กับ thumbnail ของ sold listings
// เพื่อชี้ว่าตัวไหนคือ "สินค้าชิ้นเดียวกันเป๊ะๆ" (รุ่น/ท่าทาง/edition เดียวกัน)
// เป็นตัวช่วยก่อน Match Confirmation — คนยังเป็นผู้ยืนยันขั้นสุดท้ายตาม ADR-0003
import { callGemini, imagePart, type ImageInput } from "./index";
import type { SoldListing } from "../mercari/types";

const RERANK_MAX = 24;

export type RerankResult = {
  /** listing ids ที่ AI มั่นใจว่าเป็นสินค้าชิ้นเดียวกัน */
  exactIds: string[];
  /** listing ids ที่น่าจะใช่แต่ไม่ชัวร์ */
  likelyIds: string[];
};

const PROMPT = `The first photo(s) show a plush toy owned by the user. After them, numbered marketplace listing photos follow, each preceded by its number and listing title.

Identify which listings show the EXACT same plush product as the user's — same character, same pose/expression/edition/series. A listing that shows the same character but a different variant (different pose, different series, different size class) is NOT a match. Bundle/lot listings count as "likely" at best, even if the product appears among them.

Respond in JSON:
{"exact": [listing numbers you are confident are the same product], "likely": [listing numbers that are probably the same but you are unsure]}

Use the listing titles as extra evidence (they often name the prize series). Numbers start at 1. Both arrays may be empty.`;

export async function rerankListings(
  userImages: ImageInput[],
  listings: SoldListing[],
): Promise<RerankResult> {
  const candidates = listings.slice(0, RERANK_MAX);

  const thumbs = await Promise.all(
    candidates.map(async (l) => {
      try {
        const res = await fetch(l.thumbnailUrl);
        if (!res.ok) return null;
        const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
        return { data: Buffer.from(await res.arrayBuffer()), mimeType: mime };
      } catch {
        return null;
      }
    }),
  );

  const parts: unknown[] = userImages.map(imagePart);
  const included: string[] = []; // listing id ตามลำดับเลขที่ส่งให้โมเดล
  thumbs.forEach((thumb, i) => {
    if (!thumb) return;
    included.push(candidates[i].id);
    parts.push({ text: `Listing ${included.length}: ${candidates[i].name}` });
    parts.push(imagePart(thumb));
  });

  if (included.length === 0) return { exactIds: [], likelyIds: [] };
  parts.push({ text: PROMPT });

  const text = await callGemini(parts);
  const parsed = JSON.parse(text) as { exact?: unknown; likely?: unknown };

  const toIds = (nums: unknown): string[] =>
    (Array.isArray(nums) ? nums : [])
      .filter((n): n is number => typeof n === "number" && n >= 1 && n <= included.length)
      .map((n) => included[n - 1]);

  const exactIds = toIds(parsed.exact);
  const exactSet = new Set(exactIds);
  return {
    exactIds,
    likelyIds: toIds(parsed.likely).filter((id) => !exactSet.has(id)),
  };
}
