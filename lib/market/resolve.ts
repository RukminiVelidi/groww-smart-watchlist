// Resolve a free-text company name / ISIN / ticker to an NSE trading symbol,
// using Yahoo's crumb-free search endpoint. This lets us import a broker export
// (which lists company NAMES, not tickers) and map each to the symbol our
// price/news pipeline uses.
const SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";

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

    // Indian listings only. NSE (.NS) and BSE (.BO) share the same base ticker
    // (INFY.BO -> INFY), so BSE fills gaps when Yahoo's search omits the .NS
    // row. Foreign ADRs are excluded — their ticker often differs from NSE
    // (Wipro ADR = WIT, NSE = WIPRO), so using them would silently mis-map.
    const indian = (json.quotes ?? []).filter((x) => {
      const s = String(x.symbol ?? "");
      const eq = x.quoteType === "EQUITY" || x.quoteType === undefined;
      return eq && (s.endsWith(".NS") || s.endsWith(".BO"));
    });
    if (indian.length === 0) return null;

    const base = (s: string) => s.replace(/\.(NS|BO)$/, "").toUpperCase();
    const alphabetic = (s: string) => /^[A-Z][A-Z0-9&-]*$/.test(s); // drop BSE numeric codes

    const qUpper = q.toUpperCase();
    const qTokens = tokens(q);

    // 1) Exact ticker match wins outright (handles "TCS", "INFY" inputs).
    if (indian.some((x) => base(String(x.symbol)) === qUpper)) return qUpper;

    // 2) Otherwise score by whole-token overlap with the company name; prefer
    //    the tightest match, an NSE listing, and a clean (non-hyphenated) symbol
    //    so "Infosys" -> INFY, not "HCL Infosystems".
    let best: { sym: string; score: number } | null = null;
    for (const x of indian) {
      const sym = base(String(x.symbol));
      if (!alphabetic(sym)) continue;
      const nTokens = tokens(String(x.longname ?? x.shortname ?? ""));
      const matched = qTokens.filter((t) => nTokens.includes(t)).length;
      if (matched === 0) continue;
      const extra = nTokens.filter((t) => !qTokens.includes(t)).length;
      const score =
        matched * 100 -
        extra -
        (sym.includes("-") ? 5 : 0) +
        (String(x.symbol).endsWith(".NS") ? 1 : 0);
      if (!best || score > best.score) best = { sym, score };
    }
    return best?.sym ?? null;
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
