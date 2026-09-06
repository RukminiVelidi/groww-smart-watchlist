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
  async signIn(handle: string) {
    return (await fetch("/api/session", {
      method: "POST",
      body: JSON.stringify({ handle }),
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
  async seen() {
    return (await fetch("/api/seen", { method: "POST" })).json();
  },
};

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
  const [symbol, setSymbol] = useState("");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // "Mark as read" is a client-side dismiss — moves a card out of "Needs your
  // attention" for this view. We never store read-state; on reload it's fresh.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
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
    const r = await api.signIn(input);
    setHandle(r.handle);
    await refresh();
  }

  async function doAdd() {
    if (!symbol.trim()) return;
    setLoading(true);
    setAddError(null);
    const r = await api.add(symbol);
    if (r && "error" in r && r.error) {
      setAddError(r.error as string);
      setLoading(false);
      return;
    }
    setSymbol("");
    await refresh();
    setLoading(false);
  }

  if (!handle) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900">
        <div className="w-full max-w-sm p-8 bg-white rounded-2xl shadow-sm border border-slate-200">
          <h1 className="text-xl font-bold">Smart Watchlist</h1>
          <p className="text-sm text-slate-500 mt-1">
            Sign in with any handle. Use the same handle on another device to
            see the identical watchlist — state lives on the server.
          </p>
          <input
            className="mt-4 w-full border border-slate-300 rounded-lg px-3 py-2"
            placeholder="e.g. asha"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSignIn()}
          />
          <button
            onClick={doSignIn}
            className="mt-3 w-full bg-emerald-600 text-white rounded-lg py-2 font-medium hover:bg-emerald-700"
          >
            Continue
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
          <button
            onClick={async () => { await api.seen(); refresh(); }}
            className="text-sm bg-slate-900 text-white rounded-lg px-3 py-2 hover:bg-slate-700"
          >
            Mark all as seen
          </button>
        </header>


        <div className="mt-4 flex gap-2">
          <input
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2"
            placeholder="Add a stock — e.g. RELIANCE, TCS, INFY"
            value={symbol}
            onChange={(e) => { setSymbol(e.target.value); setAddError(null); }}
            onKeyDown={(e) => e.key === "Enter" && doAdd()}
          />
          <button
            onClick={doAdd}
            disabled={loading}
            className="bg-emerald-600 text-white rounded-lg px-4 font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Add"}
          </button>
        </div>
        {addError && <p className="mt-1 text-sm text-rose-600">{addError}</p>}

        {dash && (() => {
          const attention = dash.changes.filter((c) => !dismissed.has(c.symbol));
          const cleared = dash.changes.filter((c) => dismissed.has(c.symbol));
          const everythingElse = [...cleared, ...dash.quiet];
          const onRemove = async (s: string) => { await api.remove(s); refresh(); };
          return (
            <>
              <Section title="Needs your attention" subtitle="Meaningful changes since you last checked">
                {attention.length === 0 && (
                  <p className="text-sm text-slate-500 px-1 py-6">
                    No meaningful changes since you last checked.
                  </p>
                )}
                {attention.map((c) => (
                  <ChangeCard
                    key={c.symbol}
                    c={c}
                    stale={dash.staleness[c.symbol]}
                    highlight
                    onMarkRead={(s) => setDismissed((prev) => new Set(prev).add(s))}
                    onRemove={onRemove}
                  />
                ))}
              </Section>

              {everythingElse.length > 0 && (
                <Section title="Everything else" subtitle="No meaningful change">
                  {everythingElse.map((c) => (
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
  const up = (c.current?.dayChangePct ?? 0) >= 0;
  return (
    <div
      className={`rounded-xl border p-4 bg-white flex items-start justify-between gap-4 ${
        highlight ? "border-emerald-300 ring-1 ring-emerald-100" : "border-slate-200"
      }`}
    >
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
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {c.current && (
          <span className={`text-sm font-medium ${up ? "text-emerald-600" : "text-rose-600"}`}>
            {up ? "+" : ""}
            {c.current.dayChangePct.toFixed(2)}%
          </span>
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
  );
}


