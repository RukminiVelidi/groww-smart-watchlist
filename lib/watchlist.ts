import { prisma } from "@/lib/prisma";
import { getQuotes } from "@/lib/market/adapter";
import { fetchNews } from "@/lib/market/news";
import { scoreSymbol } from "@/lib/change-engine";
import type { Quote, SymbolChange } from "@/lib/types";

const TTL_SECONDS = Number(process.env.QUOTE_FRESHNESS_TTL_SECONDS ?? 60);
const NEWS_TTL_MINUTES = Number(process.env.NEWS_TTL_MINUTES ?? 15);

// Common corporate-name words that don't identify a company on their own.
const NAME_STOP = new Set([
  "ltd", "limited", "india", "the", "co", "corporation", "company",
  "industries", "enterprises", "&",
]);

// Relevance guard: keep a headline only if it actually names the company —
// either the ticker as a whole word, or a distinctive word from its name.
// Cheap precision boost over raw Google-News relevance (kills ambiguous mis-tags).
function isRelevantNews(title: string, name: string | null, symbol: string): boolean {
  const t = title.toLowerCase();
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${esc}\\b`, "i").test(title)) return true;
  const tokens = (name ?? "")
    .toLowerCase()
    .replace(/[.,()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !NAME_STOP.has(w));
  return tokens.some((tok) => t.includes(tok));
}

// --- Watchlist mutations ----------------------------------------------------
export async function addSymbol(
  userId: string,
  symbol: string
): Promise<{ ok: boolean; error?: string }> {
  const s = symbol.trim().toUpperCase();
  if (!s) return { ok: false, error: "Enter a stock symbol." };

  // Validate against the live source BEFORE adding. If it doesn't resolve to
  // real NSE data, reject it — never create a junk row that sits forever as
  // "delayed". getQuotes returns [] for anything that isn't a real symbol.
  const quotes = await getQuotes([s]);
  if (quotes.length === 0) {
    return {
      ok: false,
      error: `"${symbol.trim()}" isn't a listed NSE symbol. Use the NSE ticker — e.g. RELIANCE, TCS, INFY.`,
    };
  }

  await prisma.watchlistItem.upsert({
    where: { userId_symbol: { userId, symbol: s } },
    update: {}, // re-adding keeps any existing seenAt
    create: { userId, symbol: s }, // seenAt null → uses the global watermark
  });
  // Persist the quote we just validated so the symbol has data on first view.
  await refreshSnapshots([s]);
  return { ok: true };
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
      volatilityPct: q.volatilityPct,
      week52High: q.week52High,
      week52Low: q.week52Low,
      marketCap: q.marketCap,
      source: q.source,
    })),
  });

  // Real news refresh runs alongside the price poll but is throttled per symbol
  // (news moves far slower than price) and parallelized so it fits within
  // serverless time limits. Best-effort: a news failure never blocks prices.
  await Promise.allSettled(quotes.map((q) => refreshNewsForSymbol(q)));
  return quotes;
}

async function refreshNewsForSymbol(q: Quote): Promise<void> {
  const now = Date.now();
  const meta = await prisma.symbolMeta.upsert({
    where: { symbol: q.symbol },
    update: { name: q.name ?? undefined },
    create: { symbol: q.symbol, name: q.name },
  });
  // Skip if we fetched news for this symbol within the throttle window.
  if (meta.lastNewsAt && now - meta.lastNewsAt.getTime() < NEWS_TTL_MINUTES * 60_000) {
    return;
  }
  try {
    const items = (await fetchNews(q.name || q.symbol)).filter((it) =>
      isRelevantNews(it.title, q.name, q.symbol)
    );
    for (const it of items) {
      await prisma.newsItem.upsert({
        where: { symbol_url: { symbol: q.symbol, url: it.url } },
        update: {}, // immutable once seen — dedupe on repeated polls
        create: {
          symbol: q.symbol,
          title: it.title,
          url: it.url,
          source: it.source,
          publishedAt: it.publishedAt,
        },
      });
    }
    await prisma.symbolMeta.update({
      where: { symbol: q.symbol },
      data: { lastNewsAt: new Date() },
    });
  } catch {
    // news is best-effort; prices are already persisted
  }
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
  const now = Date.now();
  // Single global watermark: what changed is measured since here, for every
  // stock, regardless of whether the user read prior updates.
  const lastSeenAt = user.lastSeenAt;

  const latest = await latestSnapshots(symbols);
  const metas = await prisma.symbolMeta.findMany({
    where: { symbol: { in: symbols } },
  });
  const nameBySymbol = new Map(metas.map((m) => [m.symbol, m.name]));
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

    // Baseline = latest snapshot at/just-before the global watermark.
    const baseline = await prisma.snapshot.findFirst({
      where: { symbol, fetchedAt: { lte: lastSeenAt } },
      orderBy: { fetchedAt: "desc" },
      select: { price: true },
    });

    // Meaningful events = real news published since the global watermark.
    const news = await prisma.newsItem.findMany({
      where: { symbol, publishedAt: { gt: lastSeenAt, lte: new Date() } },
      orderBy: { publishedAt: "desc" },
      take: 3,
    });

    const quote: Quote = {
      symbol: snap.symbol,
      name: nameBySymbol.get(snap.symbol) ?? null,
      price: snap.price,
      prevClose: snap.prevClose,
      dayChangePct: snap.dayChangePct,
      dayHigh: snap.dayHigh,
      dayLow: snap.dayLow,
      volume: snap.volume,
      avgVolume: snap.avgVolume,
      volatilityPct: snap.volatilityPct,
      week52High: snap.week52High,
      week52Low: snap.week52Low,
      marketCap: snap.marketCap,
      source: snap.source,
      fetchedAt: snap.fetchedAt.toISOString(),
    };

    scored.push(
      scoreSymbol({
        quote,
        baselinePrice: baseline?.price ?? null,
        dailyReturns: await dailyReturns(symbol),
        events: news.map((n) => ({ type: "NEWS", headline: `${n.title}` })),
      })
    );
  }

  scored.sort((a, b) => b.attentionScore - a.attentionScore);
  // A symbol is "meaningful" if any signal fired hard enough to matter.
  const MEANINGFUL = 0.25;
  return {
    lastSeenAt: user.lastSeenAt.toISOString(),
    changes: scored.filter((s) => s.attentionScore >= MEANINGFUL),
    quiet: scored.filter((s) => s.attentionScore < MEANINGFUL),
    staleness,
  };
}

// Advance the single global watermark to now (the explicit "I've checked
// everything" reset). Atomic single write, race-free with append-only snapshots.
export async function markSeen(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastSeenAt: new Date() },
  });
}
