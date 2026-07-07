// key-value cache บน SQLite (node:sqlite — built-in, ไม่มี native dependency)
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = path.join(process.cwd(), "data");

function openDb(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "cache.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_cache (
      key        TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    )
  `);
  return db;
}

// singleton ข้าม HMR ของ next dev
const globalForDb = globalThis as unknown as { __cacheDb?: DatabaseSync };
const db = (globalForDb.__cacheDb ??= openDb());

export function cacheGet<T>(key: string, maxAgeMs: number): T | null {
  const row = db
    .prepare("SELECT payload, fetched_at FROM kv_cache WHERE key = ?")
    .get(key) as { payload: string; fetched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.fetched_at > maxAgeMs) return null;
  return JSON.parse(row.payload) as T;
}

export function cacheSet(key: string, value: unknown): void {
  db.prepare(
    "INSERT OR REPLACE INTO kv_cache (key, payload, fetched_at) VALUES (?, ?, ?)",
  ).run(key, JSON.stringify(value), Date.now());
}
