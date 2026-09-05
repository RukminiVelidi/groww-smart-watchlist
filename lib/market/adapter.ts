import type { Quote } from "@/lib/types";

// ---------------------------------------------------------------------------
// Market-data adapter.
//
// Primary source: Yahoo Finance public quote endpoint (no API key, covers NSE
// via the ".NS" suffix, returns every signal we need in one batched call).
// Because it is delayed/consolidated data, our staleness handling is a REAL
// concern, not a staged one.
//
// Fallback: a deterministic mock generator. If Yahoo is unreachable or returns
// garbage for a symbol, we degrade gracefully to mock rather than crash — and
// the mock lets us script exact "meaningful change" scenarios for the demo.
// ---------------------------------------------------------------------------

// Yahoo's v8 chart endpoint is crumb-free and reliable (the v7 quote endpoint
// now requires an authenticated crumb). A 3-month daily window gives us the
// live quote in `meta` AND the daily volume series, from which we derive a
// stable average-volume baseline for the volume signal.
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

function toNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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
        indicators?: { quote?: { volume?: (number | null)[] }[] };
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
    week52High: toNum(meta.fiftyTwoWeekHigh),
    week52Low: toNum(meta.fiftyTwoWeekLow),
    marketCap: null, // not exposed here; engine falls back to realized vol / prior
    // Yahoo doesn't expose circuit bands; NSE default for most is +/-20%.
    upperCircuit: +(prevClose * 1.2).toFixed(2),
    lowerCircuit: +(prevClose * 0.8).toFixed(2),
    source: "yahoo",
    fetchedAt: new Date().toISOString(),
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

// Deterministic-ish mock: stable base price per symbol (hashed) plus a random
// daily move. Occasionally produces a large move / volume spike so the demo
// always has something "meaningful" to show.
function mockQuote(symbol: string): Quote {
  const seed = [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 100 + (seed % 2000);
  const move = (Math.random() - 0.5) * 8; // +/-4% typical
  const spike = Math.random() < 0.2; // 20% chance of an eventful move
  const dayChangePct = spike ? move * 3 : move;
  const prevClose = base;
  const price = +(prevClose * (1 + dayChangePct / 100)).toFixed(2);
  const avgVolume = 1_000_000 + (seed % 5) * 500_000;
  return {
    symbol,
    name: symbol,
    price,
    prevClose,
    dayChangePct: +dayChangePct.toFixed(2),
    dayHigh: +(price * 1.01).toFixed(2),
    dayLow: +(price * 0.99).toFixed(2),
    volume: Math.round(avgVolume * (spike ? 3 + Math.random() * 2 : 0.8 + Math.random())),
    avgVolume,
    week52High: +(base * 1.4).toFixed(2),
    week52Low: +(base * 0.7).toFixed(2),
    marketCap: base * avgVolume,
    upperCircuit: +(prevClose * 1.2).toFixed(2),
    lowerCircuit: +(prevClose * 0.8).toFixed(2),
    source: "mock",
    fetchedAt: new Date().toISOString(),
  };
}

// Public entry point. Fetches all symbols in one Yahoo call; any symbol Yahoo
// omits or fails falls back to mock. Per-symbol fallback means one bad symbol
// never poisons the whole batch.
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()))].filter(
    Boolean
  );
  let live = new Map<string, Quote>();
  try {
    live = await fetchFromYahoo(unique);
  } catch {
    // whole-batch failure -> everything falls back to mock below
  }
  return unique.map((s) => live.get(s) ?? mockQuote(s));
}
