import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshSnapshots } from "@/lib/watchlist";

// Touches the DB and must never be prerendered at build time.
export const dynamic = "force-dynamic";
// Price + throttled news fetch can take longer than the default serverless cap.
export const maxDuration = 60;

// The poller. Runs on a schedule (Vercel Cron). Fetches every UNIQUE symbol
// once — shared across all users — plus a seed set so the demo always has data.
// This is the scale story: cost is O(unique symbols), not O(users x symbols).
export async function GET() {
  const watched = await prisma.watchlistItem.findMany({
    distinct: ["symbol"],
    select: { symbol: true },
  });
  const seed = (process.env.POLLER_SEED_SYMBOLS ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const symbols = [...new Set([...watched.map((w) => w.symbol), ...seed])];
  const quotes = await refreshSnapshots(symbols);
  return NextResponse.json({
    polled: symbols.length,
    sources: quotes.reduce<Record<string, number>>((acc, q) => {
      acc[q.source] = (acc[q.source] ?? 0) + 1;
      return acc;
    }, {}),
    at: new Date().toISOString(),
  });
}
