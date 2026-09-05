# Smart Market Watchlist

A watchlist that answers the question a live-price list can't: **"what changed
since I last looked, and what deserves my attention first?"** — automatically,
without the user configuring a single alert.

> Groww's real watchlist is a live-price list plus *manual, threshold-based*
> alerts. The brief explicitly says *don't build the obvious watchlist*. This is
> the opposite: the **system** decides what's meaningful and ranks it for you.

**Live:** https://groww-smart-watchlist-rukmini1.vercel.app
**Design doc (architecture, diagrams, trade-offs):** [DESIGN.md](./DESIGN.md)

---

## Quickstart

```bash
cp .env.example .env      # add a free Postgres URL from https://neon.tech
npm install
npm run db:push           # create the schema
npm run dev               # http://localhost:3000

npm run smoke             # optional: prove the change engine with no DB/network
```

Sign in with any handle → add NSE symbols (RELIANCE, TCS, INFY…) → use the
**"Since"** selector (top-right) to see what changed over that window. Sign in
with the same handle on another device to get the identical watchlist.

---

## What "meaningful change" means — the core

Meaningful is **not** a fixed price threshold. A 2% move is huge for a stable
large-cap and pure noise for a volatile small-cap. Every change is scored
*relative to the stock's own normal behaviour*, across five independent signals
(`lib/change-engine.ts`), combined into one **attention score** that ranks what
to look at first:

| Signal | Rule | Why it's meaningful |
|---|---|---|
| **Price (volatility-relative)** | move since last checked ÷ the stock's typical daily move (a z-score) | Normalises for the stock's own volatility — the whole thesis in one line |
| **Volume** | today's volume vs its 3-month average | A volume spike is conviction: *something happened* |
| **Breakout** | crossed/near its 52-week high or low | A discrete technical event traders act on |
| **Circuit** | locked in upper/lower circuit | A hard, unambiguous extreme-move signal |
| **News** | a real headline published *since your last visit* | Fresh news is the clearest "something happened" |

Signals combine via **weighted noisy-OR**: each is independent evidence that
"something happened", so multiple moderate signals compound (correctly ranking
above a single strong one) but the total never exceeds 1. The dominant signal
becomes the plain-English headline on each card.

The stock's "typical daily move" comes from its own realised volatility once
there are ≥3 days of history; before that it falls back to a **market-cap-based
prior** (size strongly predicts volatility) — a principled prior, not a magic
number.

---

## Data sources — all real, nothing seeded

| Data | Source | Key? |
|---|---|---|
| Price, day change, day high/low, volume, 52-week range, company name | Yahoo Finance **`v8/chart`** (crumb-free) | none |
| Average-volume baseline (for the volume signal) | derived from Yahoo's 3-month daily series | none |
| News (the "meaningful event" signal) | **Google News RSS**, queried by the real company name, deduped, throttled per symbol | none |

These are the free equivalents of what paid apps license (Groww uses Refinitiv
for fundamentals and exchange feeds for prices). If a source is unreachable, the
price path degrades to a clearly-labelled `mock` quote and the news path yields
no events — **the app never fabricates data.**

---

## Architecture

```
Browser (React) ── /api ──▶ App server (Next.js)
                              ├─ Watchlist API        (CRUD, per user)
                              ├─ Change Engine         (5-signal attention score)
                              └─ Market-Data Adapter    (Yahoo + mock fallback,
                                                         staleness + provenance)
                                     │
                        Postgres ◀───┤   append-only snapshots
                        (Prisma)     │   users · watchlist · watermark · news
                                     │
                        Poller ──────┘   one poll per UNIQUE symbol
```

- **Append-only snapshots.** We never mutate a price row. This is what makes
  "diff since last checked" possible and correct, and it removes a whole class
  of read/write races by construction.
- **One point-in-time watermark per user** (`lastSeenAt`). "Since you last
  checked" is a single, human-sized concept. A **"Since" selector** lets the
  user widen the window (24h / 7d / 30d) so the view is never empty; new users
  default to a 7-day lookback so the watchlist is useful on first open.

---

## Resilience

- **Stale / delayed data:** every quote carries `fetchedAt` + `source`; the UI
  shows a **delayed** badge past a freshness TTL. Staleness is computed at *read*
  time (a function of "now"), never by mutating rows.
- **Conflicting sources:** the adapter dedupes by symbol and prefers the
  freshest, most-authoritative source (live over mock) — deterministic.
- **Source down / bad rows:** per-symbol fallback to a mock feed; one bad symbol
  never poisons the batch, and the app degrades instead of crashing. *(The smoke
  test demonstrates this: with no network, every symbol resolves via mock.)*
- **Race on the watermark:** `lastSeenAt` moves only on an explicit, atomic
  "mark as seen". Combined with append-only snapshots, reads can't tear and
  background polls can't lose the update.

---

## Scale

- **Fan-out:** we poll **once per unique symbol**, shared across all users —
  never per-user. Cost is **O(unique symbols)**, not O(users × symbols).
- **Read path:** deltas are computed server-side against cached snapshots, so a
  large watchlist never fans out N calls from the browser.
- **One poller, no queue.** Correct at this scale; a queue/stream would be
  over-engineering. I'd reach for one past ~thousands of symbols or sub-second
  freshness — stated, not hand-waved.
- **Autonomous updates:** a server cron (`/api/poll`, see `vercel.json`) keeps
  data fresh with no user present; active sessions also trigger the shared poll.

---

## Decisions & rejected alternatives

| Decision | Chose | Rejected | Why |
|---|---|---|---|
| Stack | Next.js full-stack | separate SPA + API | one repo, one deploy, instant live URL; still clearly layered |
| Persistence | Postgres (server-side) | `localStorage` | the brief demands cross-device — client storage fails it instantly |
| Snapshots | append-only | mutate-in-place | required for correct deltas; kills races |
| "Meaningful" | volatility-relative + multi-signal | fixed % threshold | a fixed % mis-scores both stable and volatile stocks |
| Watermark | one per user + Since selector | per-symbol watermarks | matches the "since I last checked" mental model without noise |
| Data | real API + mock fallback | mock only / real only | real makes staleness genuine; fallback keeps it resilient |

## Deliberately out of scope

Real auth/credentials, trading, charts, push notifications, microservices,
message queues — **and portfolio/broker holdings sync.** The last one is a
conscious call: this is a *watchlist* (stocks you track), not a *portfolio
tracker* (stocks you own). Holdings-sync and position-weighting would be a
different product and scope creep against "what changed since I last checked."
Naming *when* I'd add each turns every omission into a judgement call, not a gap.

---

## Project map

```
lib/change-engine.ts   the "meaningful change" scoring (pure, unit-testable)
lib/market/adapter.ts  prices: Yahoo v8/chart + mock fallback, staleness/provenance
lib/market/news.ts     news: Google News RSS reader (dependency-free parser)
lib/watchlist.ts       service layer: snapshots, news refresh, dashboard, watermark
prisma/schema.prisma   data model (doubles as documentation)
app/api/*              watchlist CRUD · seen (watermark) · poll (cron)
app/page.tsx           UI: ranked "needs attention" + quiet + staleness + Since selector
scripts/smoke.ts       proves the engine + fallback with no DB/network
```
