import { prisma } from "@/lib/prisma";
import { getQuotes } from "@/lib/market/adapter";
import { scoreSymbol } from "@/lib/change-engine";
import type { Quote, SymbolChange } from "@/lib/types";

const TTL_SECONDS = Number(process.env.QUOTE_FRESHNESS_TTL_SECONDS ?? 60);

// --- Identity ---------------------------------------------------------------
export async function getOrCreateUser(handle: string) {
  const clean = handle.trim().toLowerCase();
  return prisma.user.upsert({
    where: { handle: clean },
    update: {},
    create: { handle: clean },
  });
}

// --- Watchlist mutations ----------------------------------------------------
export async function addSymbol(userId: string, symbol: string) {
  const s = symbol.trim().toUpperCase();
  await prisma.watchlistItem.upsert({
    where: { userId_symbol: { userId, symbol: s } },
    update: {},
    create: { userId, symbol: s },
  });
  // Warm the cache immediately so the new symbol has data on first view.
  await refreshSnapshots([s]);
}

export async function removeSymbol(userId: string, symbol: string) {
  await prisma.watchlistItem.deleteMany({
    where: { userId, symbol: symbol.trim().toUpperCase() },
  });
}

export async function getSymbols(userId: string): Promise<string[]> {
  const items = await prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return items.map((i) => i.symbol);
}

// --- Snapshots (append-only) ------------------------------------------------
// Fetches quotes for the given symbols and appends one immutable snapshot each.
// Called by the poller and on-demand when a symbol is first added.
export async function refreshSnapshots(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const quotes = await getQuotes(symbols);
  await prisma.snapshot.createMany({
    data: quotes.map((q) => ({
      symbol: q.symbol,
      price: q.price,
      prevClose: q.prevClose,
      dayChangePct: q.dayChangePct,
      dayHigh: q.dayHigh,
      dayLow: q.dayLow,
      volume: q.volume,
      avgVolume: q.avgVolume,
      week52High: q.week52High,
      week52Low: q.week52Low,
      marketCap: q.marketCap,
      upperCircuit: q.upperCircuit,
      lowerCircuit: q.lowerCircuit,
      source: q.source,
    })),
  });
  return quotes;
}

// Latest snapshot per symbol, plus staleness derived at READ time (we never
// mutate a row to mark it stale — staleness is a function of "now").
async function latestSnapshots(symbols: string[]) {
  const rows = await prisma.snapshot.findMany({
    where: { symbol: { in: symbols } },
    orderBy: { fetchedAt: "desc" },
  });
  const bySymbol = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, r);
  return bySymbol;
}

// One daily return per calendar day (dayChangePct IS the close-vs-prevclose
// daily return), used by the engine for realized volatility.
async function dailyReturns(symbol: string): Promise<number[]> {
  const rows = await prisma.snapshot.findMany({
    where: { symbol },
    orderBy: { fetchedAt: "asc" },
    select: { dayChangePct: true, fetchedAt: true },
  });
  const perDay = new Map<string, number>();
  for (const r of rows) {
    perDay.set(r.fetchedAt.toISOString().slice(0, 10), r.dayChangePct);
  }
  return [...perDay.values()];
}

// --- The dashboard: "since you last checked" --------------------------------
export type Dashboard = {
  lastSeenAt: string;
  changes: SymbolChange[]; // ranked by attention, meaningful ones first
  quiet: SymbolChange[]; // everything else (no meaningful change)
  staleness: Record<string, { stale: boolean; ageSeconds: number; source: string }>;
};

export async function buildDashboard(userId: string): Promise<Dashboard> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const symbols = await getSymbols(userId);
  const lastSeenAt = user.lastSeenAt;
  const now = Date.now();

  const latest = await latestSnapshots(symbols);
  const staleness: Dashboard["staleness"] = {};
  const scored: SymbolChange[] = [];

  for (const symbol of symbols) {
    const snap = latest.get(symbol);
    if (!snap) {
      scored.push({
        symbol,
        current: null,
        baselinePrice: null,
        attentionScore: 0,
        signals: [],
        headline: "Waiting for first quote…",
      });
      staleness[symbol] = { stale: true, ageSeconds: -1, source: "none" };
      continue;
    }

    const ageSeconds = Math.round((now - snap.fetchedAt.getTime()) / 1000);
    staleness[symbol] = {
      stale: ageSeconds > TTL_SECONDS,
      ageSeconds,
      source: snap.source,
    };

    // Baseline = latest snapshot at/just-before the user's lastSeenAt.
    const baseline = await prisma.snapshot.findFirst({
      where: { symbol, fetchedAt: { lte: lastSeenAt } },
      orderBy: { fetchedAt: "desc" },
      select: { price: true },
    });

    const events = await prisma.corporateEvent.findMany({
      where: { symbol, occurredAt: { gt: lastSeenAt, lte: new Date() } },
      orderBy: { occurredAt: "desc" },
    });

    const quote: Quote = {
      symbol: snap.symbol,
      price: snap.price,
      prevClose: snap.prevClose,
      dayChangePct: snap.dayChangePct,
      dayHigh: snap.dayHigh,
      dayLow: snap.dayLow,
      volume: snap.volume,
      avgVolume: snap.avgVolume,
      week52High: snap.week52High,
      week52Low: snap.week52Low,
      marketCap: snap.marketCap,
      upperCircuit: snap.upperCircuit,
      lowerCircuit: snap.lowerCircuit,
      source: snap.source,
      fetchedAt: snap.fetchedAt.toISOString(),
    };

    scored.push(
      scoreSymbol({
        quote,
        baselinePrice: baseline?.price ?? null,
        dailyReturns: await dailyReturns(symbol),
        events: events.map((e) => ({ type: e.type, headline: e.headline })),
      })
    );
  }

  scored.sort((a, b) => b.attentionScore - a.attentionScore);
  // A symbol is "meaningful" if any signal fired hard enough to matter.
  const MEANINGFUL = 0.25;
  return {
    lastSeenAt: lastSeenAt.toISOString(),
    changes: scored.filter((s) => s.attentionScore >= MEANINGFUL),
    quiet: scored.filter((s) => s.attentionScore < MEANINGFUL),
    staleness,
  };
}

// Advancing the watermark is the ONLY place lastSeenAt moves, and it's an
// explicit user action ("mark as seen"). Snapshots are append-only, so this
// single atomic write is race-free: no background job can lose or tear it.
export async function markSeen(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastSeenAt: new Date() },
  });
}
