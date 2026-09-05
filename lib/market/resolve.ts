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

    // Only NSE-listed equities.
    const nse = (json.quotes ?? []).filter((x) =>
      String(x.symbol ?? "").endsWith(".NS")
    );
    if (nse.length === 0) return null;

    const qUpper = q.toUpperCase();
    const qTokens = tokens(q);

    // 1) Exact ticker match wins outright (handles "TCS", "INFY" inputs).
    const exact = nse.find(
      (x) => String(x.symbol).replace(/\.NS$/, "").toUpperCase() === qUpper
    );
    if (exact) return qUpper;

    // 2) Otherwise score by whole-token overlap with the company name, and
    //    prefer the tightest match (fewest extra tokens, no hyphenated symbol)
    //    so "Infosys" -> INFY, not "HCL Infosystems".
    let best: { sym: string; score: number } | null = null;
    for (const x of nse) {
      const sym = String(x.symbol).replace(/\.NS$/, "").toUpperCase();
      const name = String(x.longname ?? x.shortname ?? "");
      const nTokens = tokens(name);
      const matched = qTokens.filter((t) => nTokens.includes(t)).length;
      if (matched === 0) continue;
      const extra = nTokens.filter((t) => !qTokens.includes(t)).length;
      const score = matched * 100 - extra - (sym.includes("-") ? 5 : 0);
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
