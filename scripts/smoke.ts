import { scoreSymbol } from "@/lib/change-engine";
import { getQuotes } from "@/lib/market/adapter";
import type { Quote } from "@/lib/types";

function base(overrides: Partial<Quote>): Quote {
  return {
    symbol: "TEST",
    name: "Test Ltd",
    price: 100,
    prevClose: 100,
    dayChangePct: 0,
    dayHigh: 101,
    dayLow: 99,
    volume: 1_000_000,
    avgVolume: 1_000_000,
    week52High: 140,
    week52Low: 70,
    marketCap: 6e12,
    upperCircuit: 120,
    lowerCircuit: 80,
    source: "test",
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

console.log("=== Change engine ===");

// 1. Big move + volume spike on a large cap -> high attention.
const spike = scoreSymbol({
  quote: base({ price: 106, dayChangePct: 6, volume: 3_000_000 }),
  baselinePrice: 100,
  dailyReturns: [],
  events: [],
});
console.log("spike:", spike.attentionScore, "|", spike.headline);

// 2. Same 6% move but framed as normal for a volatile small cap -> lower price score.
const smallCap = scoreSymbol({
  quote: base({ price: 106, dayChangePct: 6, marketCap: 2e11, volume: 1_000_000 }),
  baselinePrice: 100,
  dailyReturns: [],
  events: [],
});
console.log("smallcap same %:", smallCap.attentionScore, "|", smallCap.headline);

// 3. Quiet: tiny move, normal volume -> below meaningful threshold.
const quiet = scoreSymbol({
  quote: base({ price: 100.3, dayChangePct: 0.3 }),
  baselinePrice: 100,
  dailyReturns: [],
  events: [],
});
console.log("quiet:", quiet.attentionScore, "|", quiet.headline);

// 4. 52-week high breakout.
const breakout = scoreSymbol({
  quote: base({ price: 141, dayChangePct: 2 }),
  baselinePrice: 138,
  dailyReturns: [],
  events: [],
});
console.log("breakout:", breakout.attentionScore, "|", breakout.headline);

// 5. Corporate event since last checked.
const event = scoreSymbol({
  quote: base({ price: 101, dayChangePct: 1 }),
  baselinePrice: 100,
  dailyReturns: [],
  events: [{ type: "RESULT", headline: "TEST quarterly results announced" }],
});
console.log("event:", event.attentionScore, "|", event.headline);

console.log("\nassert spike > smallcap (same % move):", spike.attentionScore > smallCap.attentionScore);
console.log("assert quiet below 0.25:", quiet.attentionScore < 0.25);

console.log("\n=== Adapter (network -> mock fallback) ===");
getQuotes(["RELIANCE", "TCS"]).then((qs) => {
  for (const q of qs) {
    console.log(`${q.symbol}: Rs ${q.price} (${q.dayChangePct}%) vol=${q.volume} src=${q.source}`);
  }
  process.exit(0);
});
