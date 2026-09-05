import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { extractCandidates } from "@/lib/import-holdings";
import { resolveMany } from "@/lib/market/resolve";
import { addSymbols } from "@/lib/watchlist";

// Resolving names + warming quotes/news can take a while.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Import holdings from a pasted list or an uploaded CSV/holdings export.
// POST { text }  -> extract candidates -> resolve to NSE symbols -> add.
export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const { text } = await req.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "no file/text provided" }, { status: 400 });
  }

  const candidates = extractCandidates(text);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "couldn't find any stocks in that input" }, { status: 400 });
  }

  const { symbols, unresolved } = await resolveMany(candidates);
  const added = await addSymbols(userId, symbols);

  return NextResponse.json({
    imported: added.length,
    symbols: added,
    unresolved, // names we couldn't map — shown to the user, never silent
  });
}
