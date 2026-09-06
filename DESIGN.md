# Smart Market Watchlist — Design

| | |
|---|---|
| **Theme** | Build a Smart Market Watchlist (CODE 2026) |
| **Live** | https://groww-smart-watchlist-rukmini1.vercel.app |
| **Stack** | Next.js (React + API routes) · Postgres/Prisma (Neon) · Vercel |

---

## Thesis — don't build the obvious watchlist

A normal watchlist shows *state* (live prices) and makes the user set manual
alerts. This one is an **attention engine**: on every visit it answers *"what has
meaningfully changed since I last looked, and what deserves attention first?"* —
with **zero configuration**. The system decides what's meaningful, per stock, and
ranks it with a plain-English reason.

---

## High-level architecture

```
Browser (React, app/page.tsx)
        │  HTTPS/JSON
        ▼
Next.js API routes  ── Change Engine (lib/change-engine.ts)   ← the core
 session · watchlist   Market Adapter (lib/market/adapter.ts) ← Yahoo + realized vol/avg vol
 seen · news · search   News reader   (lib/market/news.ts)     ← Google News RSS
        │
        ▼
Postgres (Prisma) — append-only Snapshots · users · watchlist · news · read-state
        ▲
Poller (/api/poll, Vercel Cron) — one fetch per UNIQUE symbol, shared by all users
```

- **Append-only snapshots** are the backbone: "what changed since a point in
  time" is a diff between two immutable rows, which also removes read/write races.
- **Stateless sessions** (a handle cookie; identity re-resolved per request) +
  **durable state in Postgres** → scales horizontally, persists across devices.

---

## The core: what counts as a "meaningful change"

Meaningful is **relative, not absolute** — a 2% move is huge for a stable
large-cap and noise for a volatile small-cap. Each stock is scored against **its
own recent behaviour** across four signals (`lib/change-engine.ts`):

| Signal | Rule | Basis |
|---|---|---|
| Price (volatility-relative) | `z = |move since last checked| ÷ typical daily move` | flags moves large *for this stock* |
| Volume | today's volume ÷ its 3-month average | conviction — something happened |
| Breakout | crossed / near its 52-week high or low | discrete technical event |
| News | a real headline published since your watermark | scheduled/fundamental news |

- **"Typical daily move" = the stock's realized volatility** — stddev of daily
  returns over Yahoo's 3-month series (computed in the adapter, no extra call);
  falls back to a market-cap prior only with no history.
- **Combination = weighted noisy-OR:** `score = 1 − Π(1 − wᵢ·sᵢ)` — independent
  signals compound but stay in [0,1]. `≥ 0.25` → **"Needs your attention"**
  (ranked); else quiet. The top signal becomes the headline.

This is the one piece with real depth, and it's what makes the watchlist "smart"
rather than a price list with alerts.

---

## The six "You decide" points — decision, how, why

| Requirement | How we handled it | Why (justification) |
|---|---|---|
| **What counts as a meaningful change** | 4-signal, volatility-relative attention score (above) | Absolute thresholds mis-score both stable and volatile stocks; scoring vs. the stock's own behaviour is what a human intuits |
| **What information to surface** | Ranked "Needs attention" + plain-English reason (+ underlying figures on flagged cards); a "quiet" list = the rest of the watchlist; per-stock news panel | Signal over noise: highlight the few that matter, keep the full list visible, keep quiet cards clean |
| **State persists across sessions/devices** | Handle + **scrypt-hashed PIN**; stateless cookie session; all state in Postgres keyed to the user | DB (not the cookie) is the source of truth → same handle+PIN on any device = same watchlist; stateless auth scales horizontally |
| **Stale / delayed / conflicting data** | Every quote carries `fetchedAt`; staleness computed at read time → "delayed" badge; failures **omitted, never fabricated** (last real snapshot persists); dedup by latest-per-symbol and `(symbol,url)` for news; 6s upstream timeouts | Never present stale as live or invent data; single authoritative source with deterministic freshest-wins (multi-source reconciliation is the stated next step) |
| **Scales for larger watchlists / more users** | Poll **once per unique symbol**, shared across all users → **O(unique symbols)**, not O(users×symbols); reads from cached snapshots; stateless instances; pooled DB | Decoupling fetch cost from user count is the key scaling lever; a single poller is correct until ~thousands of symbols (then shard + queue) |
| **Simple vs. complex** | Kept: watchlist + engine + news + PIN. Cut: portfolio/holdings sync, multiple lists, real-time push, broker import | Each cut is off the thesis; naming *when* we'd add them turns omissions into judgement, not gaps |

---

## Deliberately kept simple (and why)

- **No portfolio/holdings** — it's a *watchlist* (stocks you track), not a
  position tracker; holdings + P&L would be a different product.
- **No real-time push** — a 30s shared poll is near-real-time; websockets would
  need extra infra for a use case that rarely needs millisecond sync.
- **No broker OAuth / multiple lists** — scope beyond the brief.

---

## Honest limitations

- **Conflicting data**: only *stale/failed/duplicate* are demonstrated; true
  multi-source disagreement isn't (single authoritative source by choice).
- **PIN recovery**: no "forgot PIN" — we collect no email/phone, so a reset
  couldn't be secure; production would add email/OTP recovery.
- **Autocomplete**: instant local prefix search covers ~120 major NSE names;
  rarer stocks resolve via Yahoo at 3+ chars or by exact ticker (NSE's full
  list blocks server IPs).
- **Cron on Vercel free tier** is daily; active sessions also trigger the shared
  poll. Pro plan or an external 1-min pinger restores minute-level polling.

---

## Data sources (all free, no API keys)

| Data | Source |
|---|---|
| Price, day change, 52-wk range, company name, 3-mo series (→ avg volume, realized volatility) | Yahoo Finance `v8/chart` |
| Company-name autocomplete (long tail) | Yahoo `v1/search` + a bundled NSE list for instant prefixes |
| Per-stock news | Google News RSS (queried by company name, title-relevance filtered, deduped) |

If a source fails, the app degrades to the last real snapshot / no news — it
never fabricates.

---

## Project map

```
lib/change-engine.ts    the "meaningful change" scoring (pure, unit-testable)
lib/market/adapter.ts   Yahoo prices + realized volatility + avg volume + staleness
lib/market/news.ts      Google News RSS reader (dependency-free parse)
lib/market/search.ts    typeahead: local NSE list + Yahoo augment
lib/watchlist.ts        service layer: snapshots, news refresh, dashboard, watermark
lib/session.ts          handle + scrypt PIN, stateless cookie session
prisma/schema.prisma    data model (users, watchlist, snapshots, news, read-state)
app/api/*               session · watchlist · seen · poll · news · search
app/page.tsx            UI: ranked attention + quiet list + news panels + autocomplete
scripts/smoke.ts        proves the engine + graceful degradation with no DB/network
```
