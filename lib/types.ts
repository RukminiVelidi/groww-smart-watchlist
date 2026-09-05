// Normalized quote — the single shape the rest of the app depends on,
// regardless of which provider (or the mock) produced it. This adapter
// boundary is what lets us swap data sources and demo stale/conflicting
// data without touching the change engine or UI.
export type Quote = {
  symbol: string;
  price: number;
  prevClose: number;
  dayChangePct: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  avgVolume: number | null;
  week52High: number | null;
  week52Low: number | null;
  marketCap: number | null;
  upperCircuit: number | null;
  lowerCircuit: number | null;
  source: string;
  fetchedAt: string; // ISO
};

// A scored change for one symbol, ready to render in the "Since you last
// checked" panel.
export type ChangeSignal = {
  kind: "PRICE" | "VOLUME" | "BREAKOUT" | "CIRCUIT" | "EVENT";
  score: number; // 0..1
  reason: string; // plain English
};

export type SymbolChange = {
  symbol: string;
  current: Quote | null;
  baselinePrice: number | null; // price at user's lastSeenAt
  attentionScore: number; // 0..1, drives ranking
  signals: ChangeSignal[];
  headline: string; // the single dominant reason
};
