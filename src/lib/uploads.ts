// เก็บรูปอัปโหลดไว้ debug/ปรับ prompt 30 วันแล้วลบ (ตามแผนใน README)
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
};

export function saveUpload(data: Buffer, mimeType: string): string {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  cleanupOldUploads();
  const name = `${Date.now()}-${crypto.randomUUID()}${EXT_BY_MIME[mimeType] ?? ".bin"}`;
  const filePath = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(filePath, data);
  return filePath;
}

/** ลบไฟล์ที่เก่าเกิน 30 วัน — เรียกแบบ lazy ทุกครั้งที่มีอัปโหลดใหม่ ไม่ต้องมี cron */
function cleanupOldUploads(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const entry of fs.readdirSync(UPLOAD_DIR)) {
    const p = path.join(UPLOAD_DIR, entry);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch {
      // ไฟล์หายไปก่อน/ล็อกอยู่ — ข้ามได้ ไม่ใช่งานสำคัญ
    }
  }
}
