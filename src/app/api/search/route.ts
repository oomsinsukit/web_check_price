import { NextResponse } from "next/server";
import { searchSoldCached } from "@/lib/mercari";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "missing ?q=keyword" }, { status: 400 });
  }
  try {
    const result = await searchSoldCached(q);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 502 },
    );
  }
}
