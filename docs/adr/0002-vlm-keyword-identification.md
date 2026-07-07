# ระบุตัวสินค้าด้วย Vision LLM → keyword ภาษาญี่ปุ่น ไม่ใช่ visual embedding search

คนมักคาดว่าระบบ "แบบ Google Lens" ต้องเทียบรูปต่อรูป (CLIP embedding + vector DB) แต่เราจงใจไม่ทำ: plush ไม่มีฐานข้อมูลรูป reference กลาง (ต่างจากฟิกเกอร์ที่มี MyFigureCollection) การสร้างเองต้อง crawl มหาศาล ขัดเป้าเงินน้อยที่สุด

เราใช้ Vision LLM สกัด keyword ภาษาญี่ปุ่นจากรูปแทน (ตัวละคร, ぬいぐるみ/マスコット, プライズ, ไซส์, ผู้ผลิตจากป้าย tag) แล้วเอาไปค้น Mercari — เพราะ listing บน Mercari JP ตั้งชื่อตามสูตรค่อนข้างตายตัว คุณภาพ keyword จึงเป็นตัวชี้ขาดความแม่น ไม่ใช่การเทียบรูป ส่วนความแม่นระดับ "รุ่นไหนเป๊ะ" มาจาก Match Confirmation ของผู้ใช้ (ดู ADR-0003)

โมเดล: เริ่มที่ Gemini Flash-Lite (ถูกสุด, ความรู้ pop-culture ญี่ปุ่นแข็ง) → อัปเป็น Flash ถ้าไม่แม่นพอ, Qwen-VL เป็นตัวสำรอง ทุกอย่างผ่าน abstraction `identifyPlush(image, hint?) → keywords` เพื่อสลับโมเดลโดยไม่รื้อระบบ

## Considered Options

- CLIP + vector DB: แม่นระดับรุ่นสำหรับของที่มีฐาน reference — เก็บไว้เป็น phase ฟิกเกอร์ในอนาคต
- Google Cloud Vision Product Search: ต้อง upload product set เองอยู่ดีและแพงกว่า
- Anime tagger (WD Tagger/DeepDanbooru): เทรนกับภาพวาดอนิเมะ ใช้กับรูปถ่ายตุ๊กตาไม่ได้
- Self-host open-source VLM: ค่า GPU แพงกว่าจ่าย API ตามจริงหลายสิบเท่าที่สเกลนี้
