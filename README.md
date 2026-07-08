# Plush Price Checker

เว็บเช็คราคาตุ๊กตาญี่ปุ่นมือ 2 จากรูปถ่าย — สำหรับนักสะสม/ผู้ขายชาวไทยที่อยากรู้ "ราคาที่ขายได้จริง" ก่อนซื้อเข้าหรือตั้งราคาขาย

ศัพท์กลางของโปรเจกต์อยู่ใน [CONTEXT.md](./CONTEXT.md) การตัดสินใจเชิงสถาปัตยกรรมอยู่ใน [docs/adr/](./docs/adr/)

## MVP Scope

- เฉพาะ**ตุ๊กตาผ้า (plush)** — ฟิกเกอร์ไว้ phase หลัง
- แหล่งราคาเดียว: **sold listings บน Mercari JP** (ตัด Amazon ออก)
- รัน**ในเครื่อง local** ก่อน — ยังไม่ deploy สาธารณะ

## Pipeline

1. ผู้ใช้อัปโหลดรูป 1 รูป (เพิ่มได้หลายรูป + hint text, optional ทั้งคู่)
2. `identifyPlush(image, hint?)` — Gemini 2.5 Flash + **Google Search grounding** (โมเดลค้น Google เองแบบ Google Lens) สกัด keyword ญี่ปุ่นหลายระดับ เจาะจง→กว้าง พร้อมอ่านป้ายห้อยถ้าเห็น
3. `MercariClient` ไล่ค้น sold listings จากคำแคบไปกว้าง (ladder) → cache ผลใน SQLite 24 ชม.
4. AI re-rank: เทียบรูปผู้ใช้กับรูปเต็มของ listing สูงสุด 16 ตัว → ติดป้าย "ตรงเป๊ะ/น่าจะใช่" — ถ้าไม่เจอตัวตรงเลย มี self-correction เสนอคำค้นใหม่เองอีก 1 รอบ
5. หน้าผลลัพธ์: ช่วงราคา + ค่ากลาง (JPY/THB) → grid sold listings พร้อมวันที่ขาย → ผู้ใช้จิ้มตัวที่ตรง → สรุปใหม่เฉพาะรุ่นนั้น

## Stack

- Next.js + TypeScript รัน local บนเครื่องนี้
- SQLite: cache ผลค้น Mercari + เรตแลกเงิน JPY→THB (ดึงวันละครั้ง)
- รูปอัปโหลดเก็บในโฟลเดอร์ local 30 วันแล้วลบอัตโนมัติ (ไว้ debug/ปรับ prompt)
- เพดานเรียก Vision LLM ต่อวัน (Daily Cap) — ล็อกค่าใช้จ่ายตั้งแต่ dev

## เลื่อนไปตอน deploy สาธารณะ

- Rate limit ต่อ IP + Cloudflare Turnstile + privacy note
- แยก `MercariClient` ไปรันบนเครื่อง/IP บ้านถ้า IP cloud โดนบล็อก (ออกแบบเป็นโมดูลเดี่ยวเผื่อไว้แล้ว — ADR-0001)
- ราคาอ้างอิงเพิ่ม: Yahoo Auctions / Suruga-ya (ไม่ใช่ Amazon)
- ค่าหิ้ว/ค่าส่งมาไทย, phase ฟิกเกอร์ (CLIP + MyFigureCollection)
