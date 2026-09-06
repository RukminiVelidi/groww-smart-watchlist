// Typeahead search for the add box. Uses Yahoo's crumb-free search endpoint,
// returns NSE/BSE-listed equities as {symbol, name} suggestions.
const SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";

export type SymbolSuggestion = { symbol: string; name: string };

export async function searchSymbols(q: string): Promise<SymbolSuggestion[]> {
  const query = q.trim();
  if (query.length < 1) return [];
  const url = `${SEARCH}?q=${encodeURIComponent(query)}&quotesCount=30&newsCount=0`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { quotes?: Array<Record<string, unknown>> };
    const seen = new Set<string>();
    const out: SymbolSuggestion[] = [];
    for (const x of json.quotes ?? []) {
      const raw = String(x.symbol ?? "");
      const isEquity = x.quoteType === "EQUITY" || x.quoteType === undefined;
      if (!isEquity || !(raw.endsWith(".NS") || raw.endsWith(".BO"))) continue;
      const base = raw.replace(/\.(NS|BO)$/, "").toUpperCase();
      if (!/^[A-Z][A-Z0-9&-]*$/.test(base) || seen.has(base)) continue;
      seen.add(base);
      out.push({ symbol: base, name: String(x.longname ?? x.shortname ?? base) });
      if (out.length >= 12) break;
    }
    return out;
  } catch {
    return [];
  }
}
