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
    setDash(await api.add(symbol));
    setSymbol("");
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
            onClick={async () => setDash(await api.seen())}
            className="text-sm bg-slate-900 text-white rounded-lg px-3 py-2 hover:bg-slate-700"
          >
            Mark all as seen
          </button>
        </header>

        <BrokerPanel onAfter={refresh} />
        <ImportBox onAfter={refresh} />

        <div className="mt-4 flex gap-2">
          <input
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2"
            placeholder="Add NSE symbol e.g. RELIANCE, TCS, INFY"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doAdd()}
          />
          <button
            onClick={doAdd}
            disabled={loading}
            className="bg-emerald-600 text-white rounded-lg px-4 font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {dash && (
          <>
            <Section title="Needs your attention" subtitle="Meaningful changes since you last checked, ranked">
              {dash.changes.length === 0 && (
                <p className="text-sm text-slate-500 px-1 py-6">
                  Nothing meaningful has changed since you last checked. Quiet is good.
                </p>
              )}
              {dash.changes.map((c) => (
                <ChangeCard key={c.symbol} c={c} stale={dash.staleness[c.symbol]} highlight onRemove={async (s) => setDash(await api.remove(s))} />
              ))}
            </Section>

            {dash.quiet.length > 0 && (
              <Section title="Everything else" subtitle="No meaningful change">
                {dash.quiet.map((c) => (
                  <ChangeCard key={c.symbol} c={c} stale={dash.staleness[c.symbol]} onRemove={async (s) => setDash(await api.remove(s))} />
                ))}
              </Section>
            )}
          </>
        )}

        <DemoStrip onAfter={refresh} />
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
}: {
  c: SymbolChange;
  stale?: { stale: boolean; ageSeconds: number; source: string };
  highlight?: boolean;
  onRemove: (s: string) => void;
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
            <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded" title={`Last quote ${stale.ageSeconds}s ago from ${stale.source}`}>
              delayed
            </span>
          )}
          {stale && stale.source === "mock" && (
            <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">mock</span>
          )}
        </div>
        <p className={`text-sm mt-1 ${highlight ? "text-slate-800" : "text-slate-500"}`}>{c.headline}</p>
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
        <button onClick={() => onRemove(c.symbol)} className="text-xs text-slate-400 hover:text-rose-600">
          remove
        </button>
      </div>
    </div>
  );
}

// Import holdings from a broker CSV export or a pasted list of names/symbols.
// Works today with no broker API — e.g. a friend's Groww holdings export.
function ImportBox({ onAfter }: { onAfter: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    const r = await (await fetch("/api/import", { method: "POST", body: JSON.stringify({ text }) })).json();
    setBusy(false);
    if (r.error) return setMsg(r.error);
    const parts = [`Imported ${r.imported} stock${r.imported === 1 ? "" : "s"}.`];
    if (r.unresolved?.length) parts.push(`Couldn't match: ${r.unresolved.slice(0, 8).join(", ")}${r.unresolved.length > 8 ? "…" : ""}`);
    setMsg(parts.join(" "));
    setText("");
    onAfter();
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-emerald-700">
          or import from a file / paste holdings →
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">Import holdings</h3>
            <button onClick={() => setOpen(false)} className="text-slate-400 text-sm">close</button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Upload a broker CSV export, or paste stock names/symbols (one per line or comma-separated). We match names to NSE symbols automatically.</p>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="mt-3 block text-xs"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
          <textarea
            className="mt-2 w-full h-24 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder={"Reliance Industries\nTCS\nHDFC Bank\nInfosys"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button disabled={busy} onClick={submit} className="mt-2 w-full bg-slate-900 text-white rounded-lg py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-slate-500 mt-2">{msg}</p>}
    </div>
  );
}

type BrokerMeta = { id: string; label: string; help: string; fields: { key: string; label: string; placeholder?: string }[] };

// "Connect broker" — provider-agnostic. Imports the user's REAL holdings via the
// broker's own token, then offers one-click re-sync so new investments appear.
function BrokerPanel({ onAfter }: { onAfter: () => void }) {
  const [catalog, setCatalog] = useState<BrokerMeta[]>([]);
  const [status, setStatus] = useState<{ broker: string; lastSyncAt: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [brokerId, setBrokerId] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await (await fetch("/api/broker")).json();
    setCatalog(d.catalog ?? []);
    setStatus(d.status ?? null);
    if (!brokerId && d.catalog?.[0]) setBrokerId(d.catalog[0].id);
  }, [brokerId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = catalog.find((b) => b.id === brokerId);

  async function connect() {
    setBusy(true);
    setMsg(null);
    const r = await (await fetch("/api/broker", {
      method: "POST",
      body: JSON.stringify({ action: "connect", broker: brokerId, creds }),
    })).json();
    setBusy(false);
    if (r.error) return setMsg(r.error);
    setStatus(r.status);
    setOpen(false);
    setCreds({});
    setMsg(`Imported ${r.imported} holding${r.imported === 1 ? "" : "s"}.`);
    onAfter();
  }

  async function act(action: "sync" | "disconnect") {
    setBusy(true);
    setMsg(null);
    const r = await (await fetch("/api/broker", { method: "POST", body: JSON.stringify({ action }) })).json();
    setBusy(false);
    if (r.error) return setMsg(r.error);
    setStatus(r.status);
    if (action === "sync") setMsg(`Synced — ${r.imported} holding${r.imported === 1 ? "" : "s"}.`);
    onAfter();
  }

  if (status) {
    const label = catalog.find((b) => b.id === status.broker)?.label ?? status.broker;
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between text-sm">
        <span>🔗 Connected to <span className="font-medium">{label}</span>{status.lastSyncAt && ` · synced ${timeAgo(status.lastSyncAt)}`}</span>
        <span className="flex gap-3">
          <button disabled={busy} onClick={() => act("sync")} className="text-emerald-700 font-medium hover:underline disabled:opacity-50">Re-sync</button>
          <button disabled={busy} onClick={() => act("disconnect")} className="text-slate-400 hover:text-rose-600">Disconnect</button>
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {!open ? (
        <button onClick={() => setOpen(true)} className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm text-slate-600 hover:border-emerald-400 hover:text-emerald-700">
          🔗 Connect your broker to auto-import your holdings
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">Connect broker</h3>
            <button onClick={() => setOpen(false)} className="text-slate-400 text-sm">close</button>
          </div>
          <select value={brokerId} onChange={(e) => { setBrokerId(e.target.value); setCreds({}); }} className="mt-3 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {catalog.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          {selected && <p className="text-xs text-slate-500 mt-2">{selected.help}</p>}
          {selected?.fields.map((f) => (
            <input
              key={f.key}
              className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder={f.label + (f.placeholder ? ` (${f.placeholder})` : "")}
              value={creds[f.key] ?? ""}
              onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          ))}
          <button disabled={busy} onClick={connect} className="mt-3 w-full bg-emerald-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "Importing…" : "Connect & import holdings"}
          </button>
          <p className="text-[11px] text-slate-400 mt-2">Your token is used only to fetch holdings. Authenticate via your broker&apos;s official API — we never ask for your broker password.</p>
        </div>
      )}
      {msg && <p className="text-xs text-slate-500 mt-2">{msg}</p>}
    </div>
  );
}

// Collapsible demo controls — honest aids that reveal REAL data (no fabricated
// prices or events). "Rewind" moves your last-checked point back so the real
// moves and real news since then surface; "make stale" ages a real quote to
// show the delayed badge.
function DemoStrip({ onAfter }: { onAfter: () => void }) {
  const [sym, setSym] = useState("RELIANCE");
  async function call(body: object) {
    await fetch("/api/demo", { method: "POST", body: JSON.stringify(body) });
    setTimeout(onAfter, 300);
  }
  return (
    <details className="mt-10 text-sm text-slate-500">
      <summary className="cursor-pointer">Demo controls (reveal real data)</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="border rounded px-2 py-1" onClick={() => call({ action: "rewind", hours: 24 })}>
          rewind last-checked 1 day
        </button>
        <button className="border rounded px-2 py-1" onClick={() => call({ action: "rewind", hours: 168 })}>
          rewind 1 week
        </button>
        <span className="mx-1 text-slate-300">|</span>
        <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} className="border border-slate-300 rounded px-2 py-1 w-32" />
        <button className="border rounded px-2 py-1" onClick={() => call({ action: "stale", symbol: sym, ageMinutes: 30 })}>
          make stale
        </button>
        <button className="border rounded px-2 py-1" onClick={() => fetch("/api/poll").then(() => setTimeout(onAfter, 300))}>
          run poller
        </button>
      </div>
    </details>
  );
}
