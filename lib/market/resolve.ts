// Resolve a free-text company name / ISIN / ticker to an NSE trading symbol,
// using Yahoo's crumb-free search endpoint. This lets us import a broker export
// (which lists company NAMES, not tickers) and map each to the symbol our
// price/news pipeline uses.
const SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";
const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

// Confirm a base ticker actually trades on NSE by checking it returns a real
// price. Lets us safely accept a name match derived from a non-NSE listing
// (Infosys' ADR -> INFY, which validates) while rejecting ones that don't
// (Wipro's ADR WIT -> WIT.NS has no data).
async function validatesOnNse(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${CHART}/${base}.NS?range=1d&interval=1d`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const j = (await res.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: unknown } }[] };
    };
    return typeof j?.chart?.result?.[0]?.meta?.regularMarketPrice === "number";
  } catch {
    return false;
  }
}

// Normalize a name into comparable tokens, dropping corporate-suffix noise so
// "Tata Motors Limited" and "Tata Motors" compare cleanly.
const STOP = new Set(["ltd", "limited", "the", "india", "co", "corporation", "&"]);
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[.,()]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

export async function resolveToNseSymbol(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;

  // Ticker-first: if the input is a single token that trades on NSE as-is, use
  // it directly. Fixes short tickers Yahoo's search mishandles (e.g. "ITC") and
  // makes any typed ticker or single-word name resolve instantly.
  const asTicker = q.toUpperCase();
  if (/^[A-Z][A-Z0-9&-]{0,14}$/.test(asTicker) && (await validatesOnNse(asTicker))) {
    return asTicker;
  }

  const url = `${SEARCH}?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { quotes?: Array<Record<string, unknown>> };
    const quotes = (json.quotes ?? []).filter(
      (x) => x.quoteType === "EQUITY" || x.quoteType === undefined
    );
    if (quotes.length === 0) return null;

    const stripAny = (s: string) => s.replace(/\.[A-Z]+$/, "").toUpperCase();
    const stripIn = (s: string) => s.replace(/\.(NS|BO)$/, "").toUpperCase();
    const alphabetic = (s: string) => /^[A-Z][A-Z0-9&-]*$/.test(s); // drop BSE numeric codes
    const isIndian = (s: string) => s.endsWith(".NS") || s.endsWith(".BO");

    const qUpper = q.toUpperCase();
    const qTokens = tokens(q);

    // Name-match score for a quote (whole-token overlap; tighter = better).
    const scoreOf = (x: Record<string, unknown>): number | null => {
      const nTokens = tokens(String(x.longname ?? x.shortname ?? ""));
      const matched = qTokens.filter((t) => nTokens.includes(t)).length;
      if (matched === 0) return null;
      const extra = nTokens.filter((t) => !qTokens.includes(t)).length;
      return matched * 100 - extra;
    };

    // 1) Exact ticker match on an Indian listing wins outright ("TCS", "INFY").
    if (quotes.some((x) => isIndian(String(x.symbol)) && stripIn(String(x.symbol)) === qUpper))
      return qUpper;

    // 2) Best Indian (.NS/.BO) name match — the common, safe path.
    let bestIndian: { sym: string; score: number } | null = null;
    for (const x of quotes) {
      const s = String(x.symbol);
      if (!isIndian(s)) continue;
      const sym = stripIn(s);
      if (!alphabetic(sym)) continue;
      const sc = scoreOf(x);
      if (sc === null) continue;
      const score = sc - (sym.includes("-") ? 5 : 0) + (s.endsWith(".NS") ? 1 : 0);
      if (!bestIndian || score > bestIndian.score) bestIndian = { sym, score };
    }
    if (bestIndian) return bestIndian.sym;

    // 3) Fallback: Yahoo's search sometimes omits the Indian row (e.g. "Infosys"
    //    returns only the ADR). Take the best global name match, derive its base
    //    ticker, and accept it ONLY if it validates as a real NSE symbol.
    let bestGlobal: { sym: string; score: number } | null = null;
    for (const x of quotes) {
      const sym = stripAny(String(x.symbol));
      if (!alphabetic(sym)) continue;
      const sc = scoreOf(x);
      if (sc === null) continue;
      if (!bestGlobal || sc > bestGlobal.score) bestGlobal = { sym, score: sc };
    }
    if (bestGlobal && (await validatesOnNse(bestGlobal.sym))) return bestGlobal.sym;
    return null;
  } catch {
    return null;
  }
}

// Resolve many candidates in parallel; returns resolved symbols + the inputs we
// couldn't map (surfaced to the user so nothing fails silently).
export async function resolveMany(
  queries: string[]
): Promise<{ symbols: string[]; unresolved: string[] }> {
  const results = await Promise.all(
    queries.map(async (q) => ({ q, sym: await resolveToNseSymbol(q) }))
  );
  const symbols = [...new Set(results.filter((r) => r.sym).map((r) => r.sym!))];
  const unresolved = results.filter((r) => !r.sym).map((r) => r.q);
  return { symbols, unresolved };
}
