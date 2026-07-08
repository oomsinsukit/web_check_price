// AI re-rank — เทียบรูปของผู้ใช้กับ thumbnail ของ sold listings
// เพื่อชี้ว่าตัวไหนคือ "สินค้าชิ้นเดียวกันเป๊ะๆ" (รุ่น/ท่าทาง/edition เดียวกัน)
// เป็นตัวช่วยก่อน Match Confirmation — คนยังเป็นผู้ยืนยันขั้นสุดท้ายตาม ADR-0003
import {
  callGemini,
  imagePart,
  parseLenientJson,
  type ImageInput,
  type PlushIdentification,
} from "./index";
import type { SoldListing } from "../mercari/types";

// ใช้รูป orig เต็มความละเอียด — จำกัดจำนวนชดเชย payload ที่ใหญ่ขึ้น
const RERANK_MAX = 16;

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
  identification?: PlushIdentification,
): Promise<RerankResult> {
  const candidates = listings.slice(0, RERANK_MAX);

  const thumbs = await Promise.all(
    candidates.map(async (l) => {
      // รูปเต็มก่อน (แม่นกว่า) — พัง/ไม่มีค่อยถอยไป thumbnail
      for (const url of [l.photoUrl, l.thumbnailUrl]) {
        if (!url) continue;
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
          return { data: Buffer.from(await res.arrayBuffer()), mimeType: mime };
        } catch {
          // ลอง url ถัดไป
        }
      }
      return null;
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

  // บอกโมเดลว่ารุ่นของผู้ใช้มีจุดสังเกตอะไร — ช่วยให้เทียบภาพเฉียบขึ้น
  const knownDetails = identification
    ? [
        identification.seriesName && `series: ${identification.seriesName}`,
        identification.collab && `collab: ${identification.collab}`,
        identification.colorVariant && `variant: ${identification.colorVariant}`,
        identification.tagText && `tag text: ${identification.tagText}`,
        identification.distinctiveFeatures.length > 0 &&
          `features: ${identification.distinctiveFeatures.join(", ")}`,
      ]
        .filter(Boolean)
        .join("; ")
    : "";
  if (knownDetails) {
    parts.push({ text: `Known details of the user's item — ${knownDetails}` });
  }
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

/**
 * Self-correction: ผลค้นชุดปัจจุบันไม่มีตัวตรงเลย — ให้โมเดลดูรูปผู้ใช้
 * เทียบกับชื่อ listing ที่เจอ แล้วเสนอคำค้นใหม่ (grounded: ค้น Google ยืนยันชื่อรุ่นได้)
 * คืน null ถ้าไม่มีคำที่ดีกว่า
 */
export async function proposeBetterKeyword(
  userImages: ImageInput[],
  listings: SoldListing[],
  identification: PlushIdentification,
  triedKeywords: string[],
): Promise<string | null> {
  const titles = listings
    .slice(0, RERANK_MAX)
    .map((l, i) => `${i + 1}. ${l.name}`)
    .join("\n");

  const parts: unknown[] = userImages.map(imagePart);
  parts.push({
    text: `The photo(s) show a user's Japanese plush toy (identified as: ${identification.character || "?"} / series: ${identification.seriesName || "?"}).

We searched Mercari JP with these queries but none of the results visually matched the exact variant:
${triedKeywords.map((k) => `- ${k}`).join("\n")}

Result titles we got:
${titles}

Use Google Search to figure out the correct Japanese product/series name for this exact plush, then propose ONE better Mercari JP search query (2-5 space-separated Japanese terms sellers would put in listing titles). It must differ from the tried queries.

Respond ONLY with JSON: {"keyword": "..."} or {"keyword": null} if you cannot do better.`,
  });

  const text = await callGemini(parts, { grounded: true });
  const parsed = parseLenientJson<{ keyword?: string | null }>(text);
  const keyword = parsed.keyword?.trim();
  if (!keyword || triedKeywords.includes(keyword)) return null;
  return keyword;
}
