import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { getStockNews, markNewsRead } from "@/lib/news";

export const dynamic = "force-dynamic";

// GET /api/news?symbol=RELIANCE -> this user's unread news for that stock.
export async function GET(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  return NextResponse.json({ items: await getStockNews(userId, symbol) });
}

// POST /api/news { newsItemId } -> mark that headline read for this user.
export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { newsItemId } = await req.json();
  if (!newsItemId) return NextResponse.json({ error: "newsItemId required" }, { status: 400 });
  await markNewsRead(userId, newsItemId);
  return NextResponse.json({ ok: true });
}
