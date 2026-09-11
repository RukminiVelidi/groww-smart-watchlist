import type { Quote } from "@/lib/types";

// ---------------------------------------------------------------------------
// Market-data adapter.
//
// Source: Yahoo Finance v8 chart endpoint (no API key, crumb-free, covers NSE
// via the ".NS" suffix). A 3-month daily window returns the live quote in
// `meta` PLUS the daily close/volume series — from which we derive the stock's
// own average volume and realized volatility.
//
// We NEVER fabricate data. If a symbol fails or returns garbage, we return
// nothing for it this cycle; because snapshots are append-only, the last real
// value keeps showing (ageing into a "delayed" badge), and a never-fetched
// symbol is shown as awaiting data. Real, or honestly absent — never invented.
// ---------------------------------------------------------------------------

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

function toNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Realized daily volatility (%) = standard deviation of daily close-to-close
// returns over the 3-month series. This is the stock's own "typical daily
// move" — what the change engine normalizes price moves against.
function realizedVolatilityPct(closes: number[]): number | null {
  if (closes.length < 6) return null; // need enough history to be meaningful
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    rets.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return +Math.sqrt(variance).toFixed(3);
}

async function fetchOneFromYahoo(symbol: string): Promise<Quote | null> {
  const url = `${YAHOO_CHART}/${symbol}.NS?range=3mo&interval=1d`;
  const res = await fetch(url, {
    headers: {
      // Yahoo rejects requests without a browser-like UA.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(6000), // never let a slow upstream hang us
  });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);

  const json = (await res.json()) as {
    chart?: {
      result?: {
        meta?: Record<string, unknown>;
        indicators?: { quote?: { volume?: (number | null)[]; close?: (number | null)[] }[] };
      }[];
    };
  };
  const r = json?.chart?.result?.[0];
  const meta = r?.meta;
  if (!meta) return null;

  const price = toNum(meta.regularMarketPrice);
  const prevClose = toNum(meta.previousClose) ?? toNum(meta.chartPreviousClose);
  if (price === null || prevClose === null) return null;

  // Average volume over the returned daily series — a stable baseline the
  // volume-anomaly signal compares today's volume against.
  const vols = (r?.indicators?.quote?.[0]?.volume ?? []).filter(
    (v): v is number => typeof v === "number" && v > 0
  );
  const avgVolume =
    vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : null;

  // The stock's OWN realized daily volatility, computed from the same 3-month
  // daily close series — this is the true "typical daily move" the change
  // engine normalizes against (no extra API call, no size-based guess).
  const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter(
    (c): c is number => typeof c === "number" && c > 0
  );
  const volatilityPct = realizedVolatilityPct(closes);

  return {
    symbol,
    name:
      (typeof meta.longName === "string" && meta.longName) ||
      (typeof meta.shortName === "string" && meta.shortName) ||
      null,
    price,
    prevClose,
    dayChangePct:
      toNum(meta.regularMarketChangePercent) ??
      ((price - prevClose) / prevClose) * 100,
    dayHigh: toNum(meta.regularMarketDayHigh),
    dayLow: toNum(meta.regularMarketDayLow),
    volume: toNum(meta.regularMarketVolume),
    avgVolume,
    volatilityPct,
    week52High: toNum(meta.fiftyTwoWeekHigh),
    week52Low: toNum(meta.fiftyTwoWeekLow),
    marketCap: null, // not exposed here; volatility comes from the close series
    source: "yahoo",
    fetchedAt: meta.regularMarketTime
      ? new Date((meta.regularMarketTime as number) * 1000).toISOString()
      : new Date().toISOString(),
  };
}

// Fetch each symbol's chart in parallel; one failure never blocks the others.
async function fetchFromYahoo(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const settled = await Promise.allSettled(
    symbols.map((s) => fetchOneFromYahoo(s))
  );
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) out.set(symbols[i], r.value);
  });
  return out;
}

// Public entry point. Fetches all symbols in parallel and returns ONLY the ones
// that resolved to real data. Symbols that fail are omitted (no fabricated
// rows); the caller keeps the last real snapshot for them.
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()))].filter(
    Boolean
  );
  const live = await fetchFromYahoo(unique);
  return unique.map((s) => live.get(s)).filter((q): q is Quote => q != null);
}
