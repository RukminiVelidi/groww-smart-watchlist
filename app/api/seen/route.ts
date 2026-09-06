import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { markSeen, markSymbolSeen, buildDashboard } from "@/lib/watchlist";

// Mark as read. With { symbol } -> that one stock (persisted per-stock, syncs
// across devices). With no body -> mark ALL (advance the global watermark).
export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });

  let symbol: string | undefined;
  try {
    const body = await req.json();
    symbol = body?.symbol;
  } catch {
    // no body → mark all
  }

  if (symbol) await markSymbolSeen(userId, symbol);
  else await markSeen(userId);

  return NextResponse.json(await buildDashboard(userId));
}
