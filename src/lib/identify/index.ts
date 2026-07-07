// identifyPlush — abstraction เดียวสำหรับ "รูป → keyword ค้นหา" (ADR-0002)
// สลับโมเดลได้ที่นี่ที่เดียว โดยส่วนอื่นของระบบไม่ต้องรู้ว่าใช้เจ้าไหน
import { incrDailyCounter } from "../cache";

export type PlushIdentification = {
  /** คำค้น 2-3 ระดับ เรียงจากเจาะจงสุด → กว้างสุด สำหรับไล่ค้นแบบบันได */
  keywordCandidates: string[];
  /** คำค้นหลัก (= ตัวแรกของ keywordCandidates) เก็บไว้เพื่อความเข้ากันได้ */
  keyword: string;
  character: string;
  franchise: string;
  /** ชื่อซีรีส์/รุ่นของสินค้า ถ้ารู้จัก เช่น 討伐マスコット, ぬいぱれっと */
  seriesName: string;
  productType: string;
  sizeCategory: string;
  manufacturer: string;
  /** จุดสังเกตที่แยกรุ่นนี้จากรุ่นอื่น เช่น 泣き顔, さすまた持ち */
  distinctiveFeatures: string[];
  confidence: "high" | "medium" | "low";
};

export class IdentifyNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY ยังไม่ถูกตั้งค่าใน .env");
  }
}

export class DailyCapExceededError extends Error {
  constructor(cap: number) {
    super(`เกินเพดานการเรียก AI ต่อวัน (${cap} ครั้ง) — ลองใหม่พรุ่งนี้ หรือปรับ IDENTIFY_DAILY_CAP ใน .env`);
  }
}

const MODEL = process.env.IDENTIFY_MODEL ?? "gemini-2.5-flash-lite";

export type ImageInput = { data: Buffer; mimeType: string };

/** เรียก Gemini หนึ่งครั้ง (นับ Daily Cap ทุกครั้ง) — ใช้ร่วมกันทั้ง identify และ re-rank */
export async function callGemini(parts: unknown[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new IdentifyNotConfiguredError();

  const cap = Number(process.env.IDENTIFY_DAILY_CAP ?? 200);
  if (incrDailyCounter("identify") > cap) throw new DailyCapExceededError(cap);

  // free tier เจอ 503 (high demand) / 429 เป็นพักๆ — retry สั้นๆ ก่อนยอมแพ้
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      },
    );
    if (res.ok || (res.status !== 503 && res.status !== 429) || attempt >= 2) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API failed: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  return text;
}

export function imagePart(img: ImageInput): unknown {
  return {
    inline_data: { mime_type: img.mimeType, data: img.data.toString("base64") },
  };
}

const PROMPT = `You are an expert on Japanese plush toys and character goods sold on Mercari Japan.
Identify the plush toy in the photo(s). Pay special attention to what distinguishes this exact variant/edition from similar plush of the same character: pose, facial expression, held items, outfit, and the prize/product series it belongs to.

Respond in JSON with these fields:
- character: character name in Japanese as used on Mercari JP listings (e.g. "ちいかわ", "ハチワレ", "シナモロール")
- franchise: series/brand in Japanese (e.g. "ちいかわ", "サンリオ", "ポケモン")
- seriesName: the prize/product series name in Japanese if you recognize it (e.g. "討伐マスコット", "ぬいぱれっと", "もっちるおかお", "ふわもち"), else ""
- productType: one of "プライズ" (crane game/arcade prize), "正規品" (official licensed retail), "ガチャ" (capsule toy), or "" if unclear
- sizeCategory: one of "マスコット" (small/keychain size), "ぬいぐるみ" (regular), "BIG", "超BIG", or "" if unclear
- manufacturer: manufacturer if visible on tag (e.g. "FuRyu", "セガ", "San-X", "バンダイ"), else ""
- distinctiveFeatures: up to 3 short Japanese phrases describing what visually distinguishes this exact variant (e.g. ["泣き顔", "さすまた持ち"]), [] if nothing stands out
- keywordCandidates: 2-3 Mercari JP search queries ordered MOST SPECIFIC FIRST. Each 2-5 space-separated Japanese terms. The first should include series/variant details (e.g. "ちいかわ 討伐マスコット ハチワレ"), the last should be broad but safe (e.g. "ハチワレ ぬいぐるみ"). Only include terms sellers would actually put in listing titles.
- confidence: "high" if you are sure of the exact character and product type, "medium" if sure of character only, "low" if guessing`;

export async function identifyPlush(
  images: ImageInput[],
  hint?: string,
): Promise<PlushIdentification> {
  const parts: unknown[] = images.map(imagePart);
  parts.push({
    text: hint ? `${PROMPT}\n\nUser hint (Thai): ${hint}` : PROMPT,
  });

  const text = await callGemini(parts);
  const parsed = JSON.parse(text) as Partial<PlushIdentification> & {
    keywordCandidates?: unknown;
  };

  const candidates = (Array.isArray(parsed.keywordCandidates)
    ? parsed.keywordCandidates
    : []
  )
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim())
    .slice(0, 3);

  if (candidates.length === 0) {
    throw new Error("Gemini response missing keywordCandidates");
  }

  return {
    keywordCandidates: candidates,
    keyword: candidates[0],
    character: parsed.character ?? "",
    franchise: parsed.franchise ?? "",
    seriesName: parsed.seriesName ?? "",
    productType: parsed.productType ?? "",
    sizeCategory: parsed.sizeCategory ?? "",
    manufacturer: parsed.manufacturer ?? "",
    distinctiveFeatures: Array.isArray(parsed.distinctiveFeatures)
      ? parsed.distinctiveFeatures.filter((f): f is string => typeof f === "string")
      : [],
    confidence: parsed.confidence ?? "low",
  };
}
