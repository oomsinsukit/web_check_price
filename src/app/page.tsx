import PriceChecker from "@/components/PriceChecker";

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <h1>เช็คราคาตุ๊กตาญี่ปุ่นมือ 2</h1>
        <p>
          ถ่ายรูปตุ๊กตา แล้วดู<strong>ราคาที่ขายได้จริง</strong>จาก Mercari JP —
          ไม่ใช่ราคาตั้งขายโก่งๆ
        </p>
      </header>
      <PriceChecker />
    </main>
  );
}
