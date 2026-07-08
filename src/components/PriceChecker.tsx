"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SoldListing = {
  id: string;
  name: string;
  priceJpy: number;
  soldDate: string;
  thumbnailUrl: string;
  itemUrl: string;
};

type Identification = {
  keywordCandidates: string[];
  keyword: string;
  character: string;
  franchise: string;
  seriesName: string;
  productType: string;
  sizeCategory: string;
  manufacturer: string;
  distinctiveFeatures: string[];
  collab: string;
  colorVariant: string;
  tagText: string;
  hasHangTag: boolean;
  confidence: "high" | "medium" | "low";
};

const MAX_FILES = 3;

const CONFIDENCE_LABEL: Record<Identification["confidence"], string> = {
  high: "AI มั่นใจสูง",
  medium: "AI มั่นใจปานกลาง",
  low: "AI ไม่ค่อยมั่นใจ — ลองถ่ายป้าย tag เพิ่ม",
};

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const yen = (n: number) => `¥${new Intl.NumberFormat("ja-JP").format(n)}`;
const baht = (n: number) => `฿${new Intl.NumberFormat("th-TH").format(Math.round(n))}`;

export default function PriceChecker() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [keyword, setKeyword] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [identification, setIdentification] = useState<Identification | null>(null);
  const [listings, setListings] = useState<SoldListing[] | null>(null);
  const [totalFound, setTotalFound] = useState(0);
  const [exactIds, setExactIds] = useState<Set<string>>(new Set());
  const [likelyIds, setLikelyIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingKind, setLoadingKind] = useState<"photo" | "search">("search");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // การระบุตัวจากรูปมีขั้นค้น Google + เทียบภาพหลายรอบ อาจกิน 20-90 วิ
  // นับเวลาให้ผู้ใช้เห็นว่ายังทำงานอยู่ ไม่ได้ค้าง
  useEffect(() => {
    if (!loading) {
      setElapsedSec(0);
      return;
    }
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    fetch("/api/fx")
      .then((r) => r.json())
      .then((d) => setFxRate(d.rate ?? null))
      .catch(() => setFxRate(null));
  }, []);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_FILES);
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submitPhotos() {
    if (files.length === 0 || loading) return;
    setLoading(true);
    setLoadingKind("photo");
    setError(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("images", f));
      if (hint.trim()) form.append("hint", hint.trim());
      const res = await fetch("/api/check", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setIdentification(data.identification);
      setCandidates(data.identification.keywordCandidates ?? []);
      setKeyword(data.search.usedKeyword ?? data.identification.keyword);
      setListings(data.search.listings);
      setTotalFound(data.search.totalFound);
      setExactIds(new Set(data.match?.exactIds ?? []));
      setLikelyIds(new Set(data.match?.likelyIds ?? []));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }

  async function searchKeyword(q: string) {
    const kw = q.trim();
    if (!kw || loading) return;
    setLoading(true);
    setLoadingKind("search");
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(kw)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setKeyword(kw);
      setListings(data.listings);
      setTotalFound(data.totalFound);
      // ผลค้นชุดใหม่ — ป้าย match ของชุดเก่าใช้ไม่ได้แล้ว
      setExactIds(new Set());
      setLikelyIds(new Set());
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // เรียง: AI ว่าตรงเป๊ะ → น่าจะใช่ → ที่เหลือ (ในกลุ่มคงลำดับเดิม)
  const displayListings = useMemo(() => {
    if (!listings) return null;
    const rank = (l: SoldListing) =>
      exactIds.has(l.id) ? 0 : likelyIds.has(l.id) ? 1 : 2;
    return [...listings].sort((a, b) => rank(a) - rank(b));
  }, [listings, exactIds, likelyIds]);

  const stats = useMemo(() => {
    if (!listings || listings.length === 0) return null;
    const pool =
      selected.size > 0 ? listings.filter((l) => selected.has(l.id)) : listings;
    const prices = pool.map((l) => l.priceJpy);
    return {
      count: pool.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      median: median(prices),
      isSelection: selected.size > 0,
    };
  }, [listings, selected]);

  return (
    <div className="checker">
      <section className="panel">
        <label
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
          <span className="upload-icon">📷</span>
          <strong>ถ่ายรูป / เลือกรูปตุ๊กตา</strong>
          <span className="upload-sub">
            ได้สูงสุด {MAX_FILES} รูป — ถ่ายป้าย tag เพิ่มจะแม่นขึ้นมาก
          </span>
        </label>

        {previews.length > 0 && (
          <div className="preview-row">
            {previews.map((src, i) => (
              <div key={src} className="preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`รูปที่ ${i + 1}`} />
                <button
                  type="button"
                  className="preview-remove"
                  aria-label={`ลบรูปที่ ${i + 1}`}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="hint-row">
          <input
            type="text"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="บอกใบ้เพิ่ม (ไม่บังคับ) เช่น ได้จากตู้คีบ, มีป้ายห้อย"
          />
          <button
            type="button"
            className="primary"
            disabled={files.length === 0 || loading}
            onClick={submitPhotos}
          >
            {loading ? "กำลังเช็ค..." : "เช็คราคา"}
          </button>
        </div>

        <div className="divider">
          <span>หรือพิมพ์คำค้นเอง (ภาษาญี่ปุ่นได้ผลดีสุด)</span>
        </div>

        <form
          className="manual-row"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement;
            searchKeyword(input.value);
          }}
        >
          <input name="q" type="text" placeholder="เช่น ちいかわ ぬいぐるみ プライズ" />
          <button type="submit" disabled={loading}>
            ค้นหา
          </button>
        </form>
      </section>

      {error && <div className="error-box">⚠️ {error}</div>}
      {loading && (
        <div className="loading-box">
          {loadingKind === "photo" ? (
            <>
              กำลังวิเคราะห์รูปด้วย AI (ค้น Google ยืนยันรุ่น + เทียบรูปกับของที่ขายแล้ว) —
              อาจใช้เวลาถึง 1-2 นาทีสำหรับของที่หายาก ({elapsedSec}s)
            </>
          ) : (
            <>กำลังค้นราคาขายจริงจาก Mercari JP… ({elapsedSec}s)</>
          )}
        </div>
      )}

      {displayListings && !loading && (
        <section className="results">
          {identification && (
            <div className="ident-row">
              <span className={`badge badge-${identification.confidence}`}>
                {CONFIDENCE_LABEL[identification.confidence]}
              </span>
              {[
                identification.character,
                identification.seriesName,
                identification.collab,
                identification.colorVariant,
                identification.productType,
                identification.sizeCategory,
                identification.manufacturer,
                ...identification.distinctiveFeatures,
                identification.tagText && `🏷 ป้ายเขียนว่า: ${identification.tagText}`,
                identification.hasHangTag && "มีป้ายห้อย",
              ]
                .filter(Boolean)
                .map((chip) => (
                  <span key={String(chip)} className="chip">
                    {chip}
                  </span>
                ))}
            </div>
          )}

          <form
            className="keyword-row"
            onSubmit={(e) => {
              e.preventDefault();
              searchKeyword(keyword);
            }}
          >
            <label htmlFor="kw">คำค้น:</label>
            <input
              id="kw"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button type="submit" disabled={loading}>
              ค้นใหม่
            </button>
          </form>

          <div className="candidate-row">
            {candidates.length > 1 && (
              <>
                <span className="candidate-label">ลองคำค้นระดับอื่น:</span>
                {candidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`candidate-chip ${c === keyword ? "candidate-active" : ""}`}
                    disabled={loading}
                    onClick={() => searchKeyword(c)}
                  >
                    {c}
                  </button>
                ))}
              </>
            )}
            <button
              type="button"
              className={`candidate-chip ${keyword.includes("タグ付き") ? "candidate-active" : ""}`}
              disabled={loading}
              onClick={() =>
                searchKeyword(
                  keyword.includes("タグ付き")
                    ? keyword.replace(/\s*タグ付き\s*/g, " ").trim()
                    : `${keyword} タグ付き`,
                )
              }
            >
              🏷 เฉพาะมีป้าย (タグ付き)
            </button>
          </div>

          {stats ? (
            <div className="summary">
              <div className="summary-main">
                <span className="summary-median">
                  {yen(stats.median)}
                  {fxRate && (
                    <span className="summary-baht"> ≈ {baht(stats.median * fxRate)}</span>
                  )}
                </span>
                <span className="summary-label">
                  ราคากลาง{stats.isSelection ? "ของรุ่นที่เลือก" : ""} (ขายจริงแล้ว)
                </span>
              </div>
              <div className="summary-sub">
                ช่วง {yen(stats.min)} – {yen(stats.max)} จาก {stats.count} รายการ
                {stats.isSelection
                  ? " ที่เลือก"
                  : ` (ตลาดมีทั้งหมด ~${totalFound.toLocaleString()} รายการ)`}
              </div>
            </div>
          ) : (
            <div className="summary">ไม่พบรายการที่ขายแล้ว — ลองแก้คำค้นดูครับ</div>
          )}

          {displayListings.length > 0 && (
            <>
              <div className="pick-note">
                💡 จิ้มรูปที่ตรงกับของคุณ (เลือกได้หลายอัน) เพื่อคำนวณราคาเฉพาะรุ่นนั้น
                {exactIds.size > 0 && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => setSelected(new Set(exactIds))}
                  >
                    เลือกตามที่ AI ชี้ ({exactIds.size})
                  </button>
                )}
                {selected.size > 0 && (
                  <button type="button" className="link" onClick={() => setSelected(new Set())}>
                    ล้างที่เลือก ({selected.size})
                  </button>
                )}
              </div>
              <div className="grid">
                {displayListings.map((l) => (
                  <div
                    key={l.id}
                    className={`card ${selected.has(l.id) ? "card-selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSelect(l.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSelect(l.id);
                      }
                    }}
                  >
                    {selected.has(l.id) && <span className="card-check">✓</span>}
                    {exactIds.has(l.id) && (
                      <span className="match-badge match-exact">AI ว่าตรงเป๊ะ</span>
                    )}
                    {likelyIds.has(l.id) && (
                      <span className="match-badge match-likely">น่าจะใช่</span>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.thumbnailUrl} alt={l.name} loading="lazy" />
                    <div className="card-body">
                      <div className="card-price">
                        {yen(l.priceJpy)}
                        {fxRate && (
                          <span className="card-baht"> ≈ {baht(l.priceJpy * fxRate)}</span>
                        )}
                      </div>
                      <div className="card-name" title={l.name}>
                        {l.name}
                      </div>
                      <div className="card-meta">
                        <span>ขายเมื่อ {l.soldDate}</span>
                        <a
                          href={l.itemUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          ดูบน Mercari ↗
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
