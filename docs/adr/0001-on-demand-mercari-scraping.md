# ดึงข้อมูล Mercari JP แบบ on-demand scraping ผ่านโมดูล MercariClient เดียว

Mercari JP ไม่มี public API — ทุกทางเลือกคือการดึงข้อมูลแบบไม่เป็นทางการ เราเลือกยิง internal search API แบบ on-demand (ผู้ใช้ค้นเมื่อไหร่ค่อยดึง) แล้ว cache ผล 24 ชม. แทนการ crawl ล่วงหน้าหรือจ่าย scraping service เพราะต้นทุน ~0 และปริมาณ request ต่ำทำให้เสี่ยงโดนบล็อกต่ำตาม

ยอมรับแล้ว: (1) เป็น gray zone ทาง ToS ของ Mercari (2) จะพังเป็นระยะเมื่อ Mercari เปลี่ยนระบบ (เช่น token/DPoP) — เป็นงาน maintenance ตลอดชีพ

## Consequences

โค้ดที่คุย Mercari ทั้งหมดต้องถูกขังใน `MercariClient` โมดูลเดียว ส่วนอื่นเรียกผ่าน interface เท่านั้น — เพื่อให้ย้ายไปรันบนเครื่อง/IP อื่นได้ (เช่น ตอน deploy หน้าเว็บขึ้น cloud แล้ว IP โดนบล็อก) โดยไม่แตะส่วนอื่นของระบบ

## Considered Options

- Scraping service (ScraperAPI/Zyte): เสถียรกว่าแต่มีค่าใช้จ่ายต่อ request — ขัดเป้าเงินน้อยที่สุด อาจกลับมาพิจารณาเมื่อ traffic โต
- Crawl ล่วงหน้าสร้างฐานราคาเอง: แม่น/เร็วสุดตอน query แต่เสี่ยงโดนแบนสูงสุดและมีต้นทุน infra
