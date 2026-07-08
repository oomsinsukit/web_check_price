// Sold Listing — ประกาศบน Mercari JP ที่ขายสำเร็จแล้ว (ดู CONTEXT.md)
export type SoldListing = {
  id: string;
  name: string;
  priceJpy: number;
  /** วันที่ขาย (ประมาณจาก updated ของ listing) รูปแบบ YYYY-MM-DD */
  soldDate: string;
  thumbnailUrl: string;
  /** รูปเต็มความละเอียดสูง (ถ้ามี) — ใช้ตอน AI เทียบภาพ */
  photoUrl: string;
  itemUrl: string;
};

export type SoldSearchResult = {
  keyword: string;
  totalFound: number;
  listings: SoldListing[];
};
