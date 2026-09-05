// Resolve a free-text company name / ISIN / ticker to an NSE trading symbol,
// using Yahoo's crumb-free search endpoint. This lets us import a broker export
// (which lists company NAMES, not tickers) and map each to the symbol our
// price/news pipeline uses.
const SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";

export async function resolveToNseSymbol(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;
  const url = `${SEARCH}?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;

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
    const json = (await res.json()) as {
      quotes?: Array<Record<string, unknown>>;
    };
    const quotes = json.quotes ?? [];

    // Prefer an NSE-listed equity (Yahoo exchange code "NSI", symbol "*.NS").
    const nse = quotes.find(
      (x) =>
        String(x.symbol ?? "").endsWith(".NS") &&
        (x.quoteType === "EQUITY" || x.quoteType === undefined)
    );
    const pick = nse ?? quotes.find((x) => String(x.symbol ?? "").endsWith(".NS"));
    if (!pick) return null;
    return String(pick.symbol).replace(/\.NS$/, "").toUpperCase();
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
