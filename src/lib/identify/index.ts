// identifyPlush — abstraction เดียวสำหรับ "รูป → keyword ค้นหา" (ADR-0002)
// สลับโมเดลได้ที่นี่ที่เดียว โดยส่วนอื่นของระบบไม่ต้องรู้ว่าใช้เจ้าไหน
import { incrDailyCounter } from "../cache";

export type PlushIdentification = {
  /** คำค้นภาษาญี่ปุ่นที่ดีที่สุดสำหรับ Mercari JP เช่น "ちいかわ ぬいぐるみ プライズ" */
  keyword: string;
  character: string;
  franchise: string;
  productType: string;
  sizeCategory: string;
  manufacturer: string;
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

const PROMPT = `You are an expert on Japanese plush toys and character goods sold on Mercari Japan.
Identify the plush toy in the photo(s). Focus on: character, franchise, whether it is a crane-game prize (プライズ), size category, and manufacturer if a tag is visible.

Respond in JSON with these fields:
- character: character name in Japanese as used on Mercari JP listings (e.g. "ちいかわ", "ハチワレ", "シナモロール")
- franchise: series/brand in Japanese (e.g. "ちいかわ", "サンリオ", "ポケモン")
- productType: one of "プライズ" (crane game/arcade prize), "正規品" (official licensed retail), "ガチャ" (capsule toy), or "" if unclear
- sizeCategory: one of "マスコット" (small/keychain size), "ぬいぐるみ" (regular), "BIG", "超BIG", or "" if unclear
- manufacturer: manufacturer if visible on tag (e.g. "FuRyu", "セガ", "San-X", "バンダイ"), else ""
- keyword: the best Mercari JP search query, 2-4 space-separated Japanese terms, always including the character name and "ぬいぐるみ" or "マスコット". Example: "ちいかわ ぬいぐるみ プライズ"
- confidence: "high" if you are sure of the exact character and product type, "medium" if sure of character only, "low" if guessing`;

type ImageInput = { data: Buffer; mimeType: string };

export async function identifyPlush(
  images: ImageInput[],
  hint?: string,
): Promise<PlushIdentification> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new IdentifyNotConfiguredError();

  const cap = Number(process.env.IDENTIFY_DAILY_CAP ?? 200);
  if (incrDailyCounter("identify") > cap) throw new DailyCapExceededError(cap);

  const parts: unknown[] = images.map((img) => ({
    inline_data: { mime_type: img.mimeType, data: img.data.toString("base64") },
  }));
  parts.push({
    text: hint ? `${PROMPT}\n\nUser hint (Thai): ${hint}` : PROMPT,
  });

  const res = await fetch(
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API failed: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");

  const parsed = JSON.parse(text) as Partial<PlushIdentification>;
  if (!parsed.keyword) throw new Error("Gemini response missing keyword");

  return {
    keyword: parsed.keyword,
    character: parsed.character ?? "",
    franchise: parsed.franchise ?? "",
    productType: parsed.productType ?? "",
    sizeCategory: parsed.sizeCategory ?? "",
    manufacturer: parsed.manufacturer ?? "",
    confidence: parsed.confidence ?? "low",
  };
}
