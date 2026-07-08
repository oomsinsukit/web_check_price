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
  /** ชื่อ collab ถ้ามี เช่น サンリオコラボ */
  collab: string;
  /** สี/ชุดพิเศษของรุ่นนี้ ถ้ามี เช่น さくらいろ, ハロウィン */
  colorVariant: string;
  /** ข้อความชื่อสินค้า/ซีรีส์ที่อ่านได้จากป้ายห้อยในรูป (หลักฐานแม่นสุดถ้ามี) */
  tagText: string;
  /** เห็นป้ายห้อย (hang tag) ติดอยู่กับตัวตุ๊กตาไหม — มีผลต่อราคามือสอง */
  hasHangTag: boolean;
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

// 2.5-flash คือรุ่นเดียวที่ทดสอบแล้วว่า grounding ใช้ได้บน free tier ของ key นี้
// (3.x โดน 429 ไม่มีโควต้าฟรี, 2.5-flash-lite เจอ 503 บ่อย) — probe เมื่อ 2026-07-08
const MODEL = process.env.IDENTIFY_MODEL ?? "gemini-2.5-flash";

export type ImageInput = { data: Buffer; mimeType: string };

/** ดึง JSON จากคำตอบที่อาจมี ```json fence หรือข้อความห่อ (grounded call ใช้ JSON mode ไม่ได้) */
export function parseLenientJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`no JSON object in: ${text.slice(0, 120)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}

/**
 * เรียก Gemini หนึ่งครั้ง (นับ Daily Cap ทุกครั้ง) — ใช้ร่วมกันทั้ง identify และ re-rank
 * grounded: เปิด Google Search tool ให้โมเดลค้นยืนยันเองได้ (แบบ Google Lens)
 */
export async function callGemini(
  parts: unknown[],
  { grounded = false }: { grounded?: boolean } = {},
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new IdentifyNotConfiguredError();

  const cap = Number(process.env.IDENTIFY_DAILY_CAP ?? 200);
  if (incrDailyCounter("identify") > cap) throw new DailyCapExceededError(cap);

  // grounded call มีขั้นค้นเว็บจริงในตัว ช้ากว่าปกติ — ให้เวลามากกว่าแต่ต้องมีเพดาน
  // กันเครื่องมันแฮงค์ไม่รู้จบถ้า Gemini ค้างจริงๆ
  const timeoutMs = grounded ? 45_000 : 30_000;

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
          // grounding ใช้พร้อม JSON mode ไม่ได้ — grounded call ให้ตอบ JSON เป็น text แล้ว parse เอง
          ...(grounded ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: {
            ...(grounded ? {} : { responseMimeType: "application/json" }),
            temperature: 0.2,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
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
    candidates?: {
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: { webSearchQueries?: string[] };
    }[];
  };
  const candidate = data.candidates?.[0];
  // grounded call อาจตอบเป็นหลาย part — ต่อรวมทุก text part
  const text = candidate?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned no content");

  const queries = candidate?.groundingMetadata?.webSearchQueries;
  if (queries?.length) {
    console.log(`[identify] grounded searches: ${queries.join(" / ")}`);
  }
  return text;
}

export function imagePart(img: ImageInput): unknown {
  return {
    inline_data: { mime_type: img.mimeType, data: img.data.toString("base64") },
  };
}

const PROMPT = `You are an expert on Japanese plush toys and character goods sold on Mercari Japan.
Identify the plush toy in the photo(s). Pay special attention to what distinguishes this exact variant/edition from similar plush of the same character: pose, facial expression, held items, outfit, and the prize/product series it belongs to.

Use Google Search to verify the exact product/series name before answering — especially when you are not certain which prize series or release this is. Search in Japanese (e.g. "ちいかわ ぬいぐるみ さすまた プライズ") and prefer names that appear in actual marketplace listing titles.

Respond ONLY with a JSON object (no prose around it) with these fields:
- character: character name in Japanese as used on Mercari JP listings (e.g. "ちいかわ", "ハチワレ", "シナモロール")
- franchise: series/brand in Japanese (e.g. "ちいかわ", "サンリオ", "ポケモン")
- seriesName: the prize/product series name in Japanese if you recognize it (e.g. "討伐マスコット", "ぬいぱれっと", "もっちるおかお", "ふわもち"), else ""
- productType: one of "プライズ" (crane game/arcade prize), "正規品" (official licensed retail), "ガチャ" (capsule toy), or "" if unclear
- sizeCategory: one of "マスコット" (small/keychain size), "ぬいぐるみ" (regular), "BIG", "超BIG", or "" if unclear
- manufacturer: manufacturer if visible on tag (e.g. "FuRyu", "セガ", "San-X", "バンダイ"), else ""
- distinctiveFeatures: up to 3 short Japanese phrases describing what visually distinguishes this exact variant (e.g. ["泣き顔", "さすまた持ち"]), [] if nothing stands out
- collab: collaboration name in Japanese if this is a collab item (e.g. "サンリオコラボ", "ミッフィーコラボ"), else ""
- colorVariant: special color/costume edition in Japanese if any (e.g. "さくらいろ", "ハロウィン", "パジャマ"), else ""
- tagText: if a hang tag / paper tag is visible in any photo, transcribe the product or series name printed on it (Japanese) — read it carefully, this is the strongest evidence. Else ""
- hasHangTag: true if a hang tag is visibly attached to the plush, else false
- keywordCandidates: 2-3 Mercari JP search queries ordered MOST SPECIFIC FIRST. Each 2-5 space-separated Japanese terms. If tagText is readable, base the first candidate on it. Otherwise the first should include series/variant details (e.g. "ちいかわ 討伐マスコット ハチワレ"). The last should be broad but safe (e.g. "ハチワレ ぬいぐるみ"). Only include terms sellers would actually put in listing titles.
- confidence: "high" if you are sure of the exact character and product type, "medium" if sure of character only, "low" if guessing`;

export async function identifyPlush(
  images: ImageInput[],
  hint?: string,
): Promise<PlushIdentification> {
  const parts: unknown[] = images.map(imagePart);
  parts.push({
    text: hint ? `${PROMPT}\n\nUser hint (Thai): ${hint}` : PROMPT,
  });

  const text = await callGemini(parts, { grounded: true });
  const parsed = parseLenientJson<Partial<PlushIdentification> & { keywordCandidates?: unknown }>(
    text,
  );

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
    collab: parsed.collab ?? "",
    colorVariant: parsed.colorVariant ?? "",
    tagText: parsed.tagText ?? "",
    hasHangTag: parsed.hasHangTag === true,
    confidence: parsed.confidence ?? "low",
  };
}
