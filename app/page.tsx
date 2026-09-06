"use client";

import { useCallback, useEffect, useState } from "react";
import type { SymbolChange } from "@/lib/types";

type Dashboard = {
  lastSeenAt: string;
  changes: SymbolChange[];
  quiet: SymbolChange[];
  staleness: Record<string, { stale: boolean; ageSeconds: number; source: string }>;
};

const api = {
  async session() {
    return (await fetch("/api/session")).json();
  },
  async signIn(handle: string, pin: string, mode: "signin" | "signup") {
    return (await fetch("/api/session", {
      method: "POST",
      body: JSON.stringify({ handle, pin, mode }),
    })).json();
  },
  async dashboard(): Promise<Dashboard> {
    return (await fetch("/api/watchlist")).json();
  },
  async add(symbol: string) {
    return (await fetch("/api/watchlist", { method: "POST", body: JSON.stringify({ symbol }) })).json();
  },
  async remove(symbol: string) {
    return (await fetch("/api/watchlist", { method: "DELETE", body: JSON.stringify({ symbol }) })).json();
  },
  async seen(symbol?: string) {
    return (await fetch("/api/seen", {
      method: "POST",
      body: symbol ? JSON.stringify({ symbol }) : undefined,
    })).json();
  },
  async signOut() {
    return (await fetch("/api/session", { method: "DELETE" })).json();
  },
  async search(q: string): Promise<{ items: { symbol: string; name: string }[] }> {
    return (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
  },
};

// Compact Indian-style volume formatting (Cr / L).
function fmtVol(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} L`;
  return n.toLocaleString("en-IN");
}

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function Home() {
  const [handle, setHandle] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pin, setPin] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [signInError, setSignInError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [suggestions, setSuggestions] = useState<{ symbol: string; name: string }[]>([]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const d = await api.dashboard();
    if (!("error" in d)) setDash(d as Dashboard);
  }, []);

  useEffect(() => {
    api.session().then((s) => {
      if (s.handle) {
        setHandle(s.handle);
        refresh();
      }
    });
  }, [refresh]);

  // Keep data fresh. In production a server Cron polls on a schedule
  // (see vercel.json). On Vercel's free tier, cron is limited to once/day, so
  // active sessions also trigger the SHARED poll every 30s — the fetch is still
  // O(unique symbols), not per-user. We then re-pull the dashboard.
  useEffect(() => {
    if (!handle) return;
    const t = setInterval(async () => {
      try {
        await fetch("/api/poll");
      } catch {
        /* poll is best-effort; the dashboard still renders last snapshots */
      }
      refresh();
    }, 30000);
    return () => clearInterval(t);
  }, [handle, refresh]);

  async function doSignIn() {
    if (!input.trim()) return;
    setSignInError(null);
    const r = await api.signIn(input, pin, authMode);
    if (r && "error" in r && r.error) {
      setSignInError(r.error as string);
      return;
    }
    setHandle(r.handle);
    setPin("");
    await refresh();
  }

  async function doAdd(override?: string) {
    const sym = (override ?? symbol).trim();
    if (!sym) return;
    setLoading(true);
    setAddError(null);
    const r = await api.add(sym);
    if (r && "error" in r && r.error) {
      setAddError(r.error as string);
      setLoading(false);
      return;
    }
    setSymbol("");
    setSuggestions([]);
    await refresh();
    setLoading(false);
  }

  // Debounced typeahead: suggest company names as the user types.
  useEffect(() => {
    const q = symbol.trim();
    if (q.length < 1) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      const r = await api.search(q);
      setSuggestions(r.items ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [symbol]);

  if (!handle) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900">
        <div className="w-full max-w-sm p-8 bg-white rounded-2xl shadow-sm border border-slate-200">
          <h1 className="text-xl font-bold">Smart Watchlist</h1>
          {/* Sign in / Sign up toggle */}
          <div className="mt-3 grid grid-cols-2 gap-1 bg-slate-100 rounded-lg p-1 text-sm">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setAuthMode(m); setSignInError(null); }}
                className={`rounded-md py-1.5 font-medium ${authMode === m ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}
              >
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>
          <p className="text-sm text-slate-500 mt-3">
            {authMode === "signup"
              ? "Pick a handle and set a PIN. If the handle is taken, you'll be asked to choose another."
              : "Enter your handle and PIN. Same handle + PIN on any device = the same watchlist."}
          </p>
          <input
            className="mt-3 w-full border border-slate-300 rounded-lg px-3 py-2"
            placeholder="handle — e.g. asha"
            value={input}
            onChange={(e) => { setInput(e.target.value); setSignInError(null); }}
            onKeyDown={(e) => e.key === "Enter" && doSignIn()}
          />
          <input
            type="password"
            inputMode="numeric"
            className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2"
            placeholder={authMode === "signup" ? "Set a PIN (4–6 digits)" : "PIN (4–6 digits)"}
            value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setSignInError(null); }}
            onKeyDown={(e) => e.key === "Enter" && doSignIn()}
          />
          {signInError && <p className="mt-2 text-sm text-rose-600">{signInError}</p>}
          <button
            onClick={doSignIn}
            className="mt-3 w-full bg-emerald-600 text-white rounded-lg py-2 font-medium hover:bg-emerald-700"
          >
            {authMode === "signup" ? "Create account" : "Sign in"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-3xl mx-auto p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Smart Watchlist</h1>
            <p className="text-sm text-slate-500">
              Signed in as <span className="font-medium">{handle}</span>
              {dash && ` · last checked ${timeAgo(dash.lastSeenAt)}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => { await api.seen(); refresh(); }}
              className="text-sm bg-slate-900 text-white rounded-lg px-3 py-2 hover:bg-slate-700"
            >
              Mark all as seen
            </button>
            <button
              onClick={async () => { await api.signOut(); setHandle(null); setDash(null); setInput(""); }}
              className="text-sm text-slate-400 hover:text-rose-600"
            >
              Sign out
            </button>
          </div>
        </header>


        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              placeholder="Search a stock — e.g. Reliance, TCS, Infosys"
              value={symbol}
              onChange={(e) => { setSymbol(e.target.value); setAddError(null); }}
              onKeyDown={(e) => e.key === "Enter" && doAdd()}
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-md max-h-64 overflow-auto">
                {suggestions.map((s) => (
                  <li key={s.symbol}>
                    <button
                      onClick={() => doAdd(s.symbol)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-baseline gap-2"
                    >
                      <span className="font-medium text-sm">{s.symbol}</span>
                      <span className="text-xs text-slate-500 truncate">{s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={() => doAdd()}
            disabled={loading}
            className="bg-emerald-600 text-white rounded-lg px-4 font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Add"}
          </button>
        </div>
        {addError && <p className="mt-1 text-sm text-rose-600">{addError}</p>}

        {dash && (() => {
          const onRemove = async (s: string) => { await api.remove(s); refresh(); };
          // Server-persisted: marking read advances this stock's watermark, so
          // it drops to "Everything else" and the change syncs across devices.
          const onMarkRead = async (s: string) => {
            const d = await api.seen(s);
            if (!("error" in d)) setDash(d as Dashboard);
          };
          return (
            <>
              <Section title="Needs your attention" subtitle="Meaningful changes since you last checked">
                {dash.changes.length === 0 && (
                  <p className="text-sm text-slate-500 px-1 py-6">
                    No meaningful changes since you last checked.
                  </p>
                )}
                {dash.changes.map((c) => (
                  <ChangeCard
                    key={c.symbol}
                    c={c}
                    stale={dash.staleness[c.symbol]}
                    highlight
                    onMarkRead={onMarkRead}
                    onRemove={onRemove}
                  />
                ))}
              </Section>

              {dash.quiet.length > 0 && (
                <Section title="Everything else" subtitle="No meaningful change">
                  {dash.quiet.map((c) => (
                    <ChangeCard key={c.symbol} c={c} stale={dash.staleness[c.symbol]} onRemove={onRemove} />
                  ))}
                </Section>
              )}
            </>
          );
        })()}
      </div>
    </main>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-xs text-slate-500 mb-3">{subtitle}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ChangeCard({
  c,
  stale,
  highlight,
  onRemove,
  onMarkRead,
}: {
  c: SymbolChange;
  stale?: { stale: boolean; ageSeconds: number; source: string };
  highlight?: boolean;
  onRemove: (s: string) => void;
  onMarkRead?: (s: string) => void;
}) {
  // Per-stock number = today's change vs previous close (the universal watchlist
  // figure — always meaningful, never all-zeros when the market is closed). The
  // "since you last checked" delta lives in the "Needs your attention" headline,
  // where it only appears when something meaningful actually moved.
  const [showNews, setShowNews] = useState(false);
  const up = (c.current?.dayChangePct ?? 0) >= 0;
  return (
    <div
      className={`rounded-xl border p-4 bg-white ${
        highlight ? "border-emerald-300 ring-1 ring-emerald-100" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{c.symbol}</span>
          {c.current && (
            <span className="text-slate-500 text-sm">₹{c.current.price.toLocaleString("en-IN")}</span>
          )}
          {stale?.stale && (
            <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded" title={`Last quote ${stale.ageSeconds}s ago`}>
              delayed
            </span>
          )}
        </div>
        {highlight && <p className="text-sm mt-1 text-slate-800">{c.headline}</p>}
        {highlight && c.signals.length > 1 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {c.signals.map((s, i) => (
              <li key={i} className="text-[11px] bg-slate-100 text-slate-600 rounded px-2 py-0.5">
                {s.reason}
              </li>
            ))}
          </ul>
        )}
        {/* Underlying figures behind the signals — attention cards only. */}
        {highlight && c.current && (c.current.volatilityPct || c.current.avgVolume) && (
          <p className="text-[11px] text-slate-400 mt-1">
            {c.current.volatilityPct ? `~${c.current.volatilityPct.toFixed(1)}%/day typical move` : ""}
            {c.current.volatilityPct && c.current.avgVolume ? " · " : ""}
            {c.current.avgVolume ? `avg volume ${fmtVol(c.current.avgVolume)}` : ""}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {c.current && (
          <div className="text-right leading-tight">
            <div className={`text-sm font-medium ${up ? "text-emerald-600" : "text-rose-600"}`}>
              {up ? "+" : ""}
              {c.current.dayChangePct.toFixed(2)}%
            </div>
            <div className="text-[10px] text-slate-400">today</div>
          </div>
        )}
        {highlight && onMarkRead && (
          <button onClick={() => onMarkRead(c.symbol)} className="text-xs text-emerald-700 font-medium hover:underline">
            ✓ mark as read
          </button>
        )}
        <button onClick={() => onRemove(c.symbol)} className="text-xs text-slate-400 hover:text-rose-600">
          remove
        </button>
      </div>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-2">
        <button onClick={() => setShowNews((v) => !v)} className="text-xs text-slate-500 hover:text-emerald-700">
          {showNews ? "Hide news" : "📰 News"}
        </button>
        {showNews && <StockNews symbol={c.symbol} />}
      </div>
    </div>
  );
}

type NewsRow = { id: string; title: string; url: string; source: string; publishedAt: string };

// Per-stock news, loaded on demand. Each headline can be marked read, which
// persists per-user (across sessions) and removes it from this list.
function StockNews({ symbol }: { symbol: string }) {
  const [items, setItems] = useState<NewsRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setItems(d.items ?? []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [symbol]);

  async function markRead(id: string) {
    setItems((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    await fetch("/api/news", { method: "POST", body: JSON.stringify({ newsItemId: id }) });
  }

  if (items === null) return <p className="text-xs text-slate-400 mt-2">Loading news…</p>;
  if (items.length === 0) return <p className="text-xs text-slate-400 mt-2">No unread news for this stock.</p>;
  return (
    <ul className="mt-2 space-y-2">
      {items.map((n) => (
        <li key={n.id} className="flex items-start justify-between gap-3">
          <a href={n.url} target="_blank" rel="noreferrer" className="text-xs text-slate-700 hover:underline">
            {n.title}
            <span className="block text-[10px] text-slate-400 mt-0.5">{n.source} · {timeAgo(n.publishedAt)}</span>
          </a>
          <button onClick={() => markRead(n.id)} className="text-[11px] text-emerald-700 hover:underline shrink-0">
            ✓ read
          </button>
        </li>
      ))}
    </ul>
  );
}


