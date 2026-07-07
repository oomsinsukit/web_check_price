import { NextResponse } from "next/server";
import { getJpyThbRate } from "@/lib/fx";

export async function GET() {
  const rate = await getJpyThbRate();
  return NextResponse.json({ rate });
}
