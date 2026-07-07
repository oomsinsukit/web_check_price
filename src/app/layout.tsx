import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "เช็คราคาตุ๊กตาญี่ปุ่นมือ 2",
  description:
    "ถ่ายรูปตุ๊กตา แล้วดูราคาที่ขายได้จริงจาก Mercari JP — สำหรับนักสะสมและผู้ขายชาวไทย",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
