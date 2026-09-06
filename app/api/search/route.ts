import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/market/search";

export const dynamic = "force-dynamic";

// GET /api/search?q=reli -> [{ symbol, name }] suggestions for the add box.
export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: await searchSymbols(q) });
}
