import type { Quote, ChangeSignal, SymbolChange } from "@/lib/types";

// ===========================================================================
// The Change Engine — our definition of "meaningful change".
//
// Core thesis: "meaningful" is NOT a fixed price threshold. A 2% move is huge
// for a stable large-cap and pure noise for a volatile small-cap. So we score
// every change RELATIVE to the stock's own normal behavior, across five
// independent signals, and combine them into one attention score used to rank
// what deserves the user's attention first.
// ===========================================================================

// Signal weights. Discrete, hard events (a corporate result, a circuit lock, a
// 52-week breakout) are stronger evidence that "something happened" than a
// continuous drift, so they carry more weight.
const WEIGHTS: Record<ChangeSignal["kind"], number> = {
  EVENT: 1.0,
  BREAKOUT: 0.9,
  PRICE: 0.8,
  VOLUME: 0.6,
};

// Prior for a stock's typical DAILY move, used only when we lack enough of the
// stock's own history. Market cap strongly predicts realized volatility, so we
// bucket by size — a principled prior, not a magic number.
function typicalDailyMovePct(marketCap: number | null): number {
  if (marketCap === null) return 2.0;
  if (marketCap > 5e12) return 1.2; // mega/large cap (> ~5 lakh Cr)
  if (marketCap > 5e11) return 1.8; // mid cap
  return 2.8; // small cap
}

// Realized daily volatility from our own snapshot history, when we have it.
// history = chronological list of daily % returns for this symbol.
export function realizedVolatilityPct(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 3) return null;
  const mean =
    dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) /
    (dailyReturns.length - 1);
  return Math.sqrt(variance);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

type ScoreInput = {
  quote: Quote;
  baselinePrice: number | null; // price at user's lastSeenAt
  dailyReturns: number[]; // for realized-volatility, chronological
  events: { type: string; headline: string }[]; // events since lastSeen
};

export function scoreSymbol(input: ScoreInput): SymbolChange {
  const { quote, baselinePrice, dailyReturns, events } = input;
  const signals: ChangeSignal[] = [];

  // Prefer the stock's OWN realized volatility (from the 3-month close series,
  // attached to the quote). Fall back to volatility computed from our collected
  // snapshots, then to a market-cap-based prior only if we have neither.
  const vol =
    (quote.volatilityPct && quote.volatilityPct > 0 ? quote.volatilityPct : null) ??
    realizedVolatilityPct(dailyReturns) ??
    typicalDailyMovePct(quote.marketCap);

  // --- PRICE: move since last checked, normalized by the stock's own vol ---
  // If we have a baseline (user has looked before) we measure the move since
  // then; otherwise we fall back to today's move. Either way it's a z-score:
  // how many "normal daily moves" is this?
  const movePct =
    baselinePrice !== null
      ? ((quote.price - baselinePrice) / baselinePrice) * 100
      : quote.dayChangePct;
  const z = Math.abs(movePct) / vol;
  if (z >= 0.75) {
    const dir = movePct >= 0 ? "up" : "down";
    const since = baselinePrice !== null ? " since you last checked" : " today";
    signals.push({
      kind: "PRICE",
      score: clamp01(z / 2), // ~2 sigma = full score
      reason: `${dir === "up" ? "↑" : "↓"} ${Math.abs(movePct).toFixed(
        1
      )}%${since} — ${z.toFixed(1)}× its typical daily move`,
    });
  }

  // --- VOLUME: conviction. A volume spike means something happened. ---
  if (quote.volume !== null && quote.avgVolume && quote.avgVolume > 0) {
    const ratio = quote.volume / quote.avgVolume;
    if (ratio >= 1.5) {
      signals.push({
        kind: "VOLUME",
        score: clamp01((ratio - 1) / 2), // 3x = full score
        reason: `Trading at ${ratio.toFixed(1)}× its usual volume`,
      });
    }
  }

  // --- BREAKOUT: a discrete technical event traders act on. ---
  if (quote.week52High !== null && quote.price >= quote.week52High) {
    signals.push({ kind: "BREAKOUT", score: 1, reason: "New 52-week high" });
  } else if (quote.week52Low !== null && quote.price <= quote.week52Low) {
    signals.push({ kind: "BREAKOUT", score: 1, reason: "New 52-week low" });
  } else if (
    quote.week52High !== null &&
    quote.price >= quote.week52High * 0.985
  ) {
    signals.push({
      kind: "BREAKOUT",
      score: 0.5,
      reason: "Approaching its 52-week high",
    });
  }

  // --- EVENT: real news published since the user last looked. ---
  for (const e of events) {
    signals.push({
      kind: "EVENT",
      score: 1,
      reason: e.headline,
    });
  }

  // Combine via weighted noisy-OR: each signal is independent evidence that
  // "something happened". Multiple moderate signals compound (correctly
  // ranking above a single strong one) but the total never exceeds 1.
  const attentionScore =
    1 -
    signals.reduce(
      (acc, s) => acc * (1 - WEIGHTS[s.kind] * s.score),
      1
    );

  // The dominant reason = the single highest weighted signal.
  const headline =
    [...signals].sort(
      (a, b) => WEIGHTS[b.kind] * b.score - WEIGHTS[a.kind] * a.score
    )[0]?.reason ?? "No meaningful change";

  return {
    symbol: quote.symbol,
    current: quote,
    baselinePrice,
    attentionScore: +attentionScore.toFixed(4),
    signals,
    headline,
  };
}
