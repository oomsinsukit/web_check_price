import { NextResponse } from "next/server";
import {
  identifyPlush,
  IdentifyNotConfiguredError,
  DailyCapExceededError,
} from "@/lib/identify";
import { rerankListings, type RerankResult } from "@/lib/identify/rerank";
import { searchSoldLadder } from "@/lib/mercari";
import { saveUpload } from "@/lib/uploads";

const MAX_FILES = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("images").filter((f): f is File => f instanceof File);
  const hint = String(form.get("hint") ?? "").trim() || undefined;

  if (files.length === 0) {
    return NextResponse.json({ error: "ต้องแนบรูปอย่างน้อย 1 รูป" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `แนบได้สูงสุด ${MAX_FILES} รูป` }, { status: 400 });
  }

  const images: { data: Buffer; mimeType: string }[] = [];
  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `ชนิดไฟล์ไม่รองรับ (${file.type || "unknown"}) — ใช้ JPG/PNG/WebP` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 8MB" }, { status: 400 });
    }
    images.push({ data: Buffer.from(await file.arrayBuffer()), mimeType: file.type });
  }

  for (const img of images) {
    saveUpload(img.data, img.mimeType);
  }

  try {
    const identification = await identifyPlush(images, hint);
    const search = await searchSoldLadder(identification.keywordCandidates);

    // re-rank ล้มเหลวไม่ควรทำให้ทั้ง request พัง — แค่ไม่มีป้ายช่วยจิ้ม
    let match: RerankResult = { exactIds: [], likelyIds: [] };
    if (search.listings.length > 0) {
      try {
        match = await rerankListings(images, search.listings, identification);
      } catch (err) {
        console.error("rerank failed:", err);
      }
    }

    return NextResponse.json({ identification, search, match });
  } catch (err) {
    if (err instanceof IdentifyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof DailyCapExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" },
      { status: 502 },
    );
  }
}
