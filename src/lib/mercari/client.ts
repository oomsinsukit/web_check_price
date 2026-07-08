// MercariClient — โค้ดคุยกับ Mercari ทั้งหมดต้องอยู่ในไฟล์นี้เท่านั้น (ADR-0001)
// internal API ไม่มีสัญญาใดๆ: เปลี่ยนได้ทุกเมื่อ ถ้าพังให้ดูที่นี่ก่อน
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import crypto from "node:crypto";
import type { SoldListing, SoldSearchResult } from "./types";

const SEARCH_URL = "https://api.mercari.jp/v2/entities:search";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function makeDpop(method: string, url: string): Promise<string> {
  // Mercari ยอมรับ DPoP ที่เซ็นด้วย ephemeral key ที่ client generate เอง
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  return new SignJWT({
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    htu: url,
    htm: method,
    uuid: crypto.randomUUID(),
  })
    .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk })
    .sign(privateKey);
}

function itemUrl(id: string): string {
  // id ขึ้นต้น m+ตัวเลข = Mercari ปกติ, อื่นๆ = Mercari Shops
  return /^m\d+$/.test(id)
    ? `https://jp.mercari.com/item/${id}`
    : `https://jp.mercari.com/shops/product/${id}`;
}

function photoUrl(id: string, thumbnailUrl: string): string {
  // Mercari ปกติมีรูปเต็มตาม pattern ตายตัว (ยืนยันแล้ว) — Shops ใช้ thumbnail ไปก่อน
  return /^m\d+$/.test(id)
    ? `https://static.mercdn.net/item/detail/orig/photos/${id}_1.jpg`
    : thumbnailUrl;
}

type RawItem = {
  id: string;
  name: string;
  price: string | number;
  updated?: string;
  thumbnails?: string[];
  status?: string;
};

export async function searchSold(
  keyword: string,
  { pageSize = 60 }: { pageSize?: number } = {},
): Promise<SoldSearchResult> {
  const body = {
    userId: "",
    pageSize,
    pageToken: "",
    searchSessionId: crypto.randomBytes(16).toString("hex"),
    indexRouting: "INDEX_ROUTING_UNSPECIFIED",
    thumbnailTypes: [],
    searchCondition: {
      keyword,
      excludeKeyword: "",
      sort: "SORT_CREATED_TIME",
      order: "ORDER_DESC",
      status: ["STATUS_SOLD_OUT"],
      sizeId: [],
      categoryId: [],
      brandId: [],
      sellerId: [],
      priceMin: 0,
      priceMax: 0,
      itemConditionId: [],
      shippingPayerId: [],
      shippingFromArea: [],
      shippingMethod: [],
      colorId: [],
      hasCoupon: false,
      attributes: [],
      itemTypes: [],
      skuIds: [],
    },
    defaultDatasets: ["DATASET_TYPE_MERCARI", "DATASET_TYPE_BEYOND"],
    serviceFrom: "suruga",
  };

  const dpop = await makeDpop("POST", SEARCH_URL);
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      DPoP: dpop,
      "X-Platform": "web",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mercari search failed: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { items?: RawItem[]; meta?: { numFound?: string } };
  const listings: SoldListing[] = (data.items ?? []).map((it) => ({
    id: it.id,
    name: it.name,
    priceJpy: Number(it.price),
    soldDate: it.updated
      ? new Date(Number(it.updated) * 1000).toISOString().slice(0, 10)
      : "",
    thumbnailUrl: it.thumbnails?.[0] ?? "",
    photoUrl: photoUrl(it.id, it.thumbnails?.[0] ?? ""),
    itemUrl: itemUrl(it.id),
  }));

  return {
    keyword,
    totalFound: Number(data.meta?.numFound ?? listings.length),
    listings,
  };
}
