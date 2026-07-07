// PoC: ค้น sold listings จาก Mercari JP internal search API
// ใช้: node poc/mercari-search.mjs "ちいかわ ぬいぐるみ"
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import crypto from "node:crypto";

const SEARCH_URL = "https://api.mercari.jp/v2/entities:search";

async function makeDpop(method, url) {
  // Mercari ยอมรับ DPoP ที่เซ็นด้วย ephemeral key ที่เรา generate เอง
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

async function searchSold(keyword, { pageSize = 30 } = {}) {
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
      status: (process.argv[3] ?? "sold") === "sold" ? ["STATUS_SOLD_OUT"] : ["STATUS_SOLD_OUT", "STATUS_TRADING"],
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

const keyword = process.argv[2] ?? "ちいかわ ぬいぐるみ";
console.log(`ค้นหา: ${keyword}\n`);

const data = await searchSold(keyword);
const items = data.items ?? [];
console.log(`ได้ ${items.length} รายการ (meta: ${JSON.stringify(data.meta ?? {}).slice(0, 200)})\n`);

for (const it of items.slice(0, 10)) {
  const updated = it.updated ? new Date(Number(it.updated) * 1000).toISOString().slice(0, 10) : "?";
  console.log(`[${it.status}] ¥${it.price}  ${updated}  ${it.name}`);
  console.log(`   id=${it.id}  thumb=${(it.thumbnails ?? [])[0] ?? "-"}`);
}
