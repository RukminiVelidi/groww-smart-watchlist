import { NSE_SYMBOLS } from "./nse-symbols";

// Typeahead for the add box. LOCAL prefix/substring match over a bundled list of
// major NSE stocks gives instant results from the first letter (Yahoo's search
// can't do short prefixes). For longer queries we augment with live Yahoo search
// to cover the long tail beyond the bundled list.
const SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";

export type SymbolSuggestion = { symbol: string; name: string };

function localMatches(query: string): SymbolSuggestion[] {
  const q = query.toLowerCase();
  const bySymbol: SymbolSuggestion[] = [];
  const byName: SymbolSuggestion[] = [];
  for (const s of NSE_SYMBOLS) {
    if (s.symbol.toLowerCase().startsWith(q)) {
      bySymbol.push(s);
    } else if (
      s.name.toLowerCase().split(/[\s&(]+/).some((w) => w.startsWith(q))
    ) {
      // match a WORD prefix in the name (so "t" → Tata/Titan/Trent, not every
      // name that merely contains the letter "t")
      byName.push(s);
    }
  }
  return [...bySymbol, ...byName]; // symbol-prefix matches rank first
}

async function yahooMatches(query: string): Promise<SymbolSuggestion[]> {
  const url = `${SEARCH}?q=${encodeURIComponent(query)}&quotesCount=20&newsCount=0`;
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
    const out: SymbolSuggestion[] = [];
    for (const x of json.quotes ?? []) {
      const raw = String(x.symbol ?? "");
      const isEquity = x.quoteType === "EQUITY" || x.quoteType === undefined;
      if (!isEquity || !(raw.endsWith(".NS") || raw.endsWith(".BO"))) continue;
      const base = raw.replace(/\.(NS|BO)$/, "").toUpperCase();
      if (!/^[A-Z][A-Z0-9&-]*$/.test(base)) continue;
      out.push({ symbol: base, name: String(x.longname ?? x.shortname ?? base) });
    }
    return out;
  } catch {
    return [];
  }
}

export async function searchSymbols(q: string): Promise<SymbolSuggestion[]> {
  const query = q.trim();
  if (!query) return [];

  const seen = new Set<string>();
  const out: SymbolSuggestion[] = [];
  const push = (s: SymbolSuggestion) => {
    if (seen.has(s.symbol) || out.length >= 12) return;
    seen.add(s.symbol);
    out.push(s);
  };

  // Instant local results first (works from the first letter).
  for (const s of localMatches(query)) push(s);

  // Augment with Yahoo for longer queries (long tail beyond the bundled list).
  if (query.length >= 3 && out.length < 12) {
    for (const s of await yahooMatches(query)) push(s);
  }
  return out;
}
