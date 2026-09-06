# Smart Market Watchlist — Handover & Ops Guide

Everything you need to run, update, deploy, and debug this project later.

| | |
|---|---|
| **Live app** | https://groww-smart-watchlist-rukmini1.vercel.app |
| **Repo** | https://github.com/RukminiVelidi/groww-smart-watchlist |
| **Hosting** | Vercel (project `groww-smart-watchlist`, scope `rukmini1`) |
| **Database** | Neon Postgres (via Prisma) |
| **Data sources** | Yahoo Finance (`v8/chart`, `v1/search`) · Google News RSS — free, no keys |

---

## 1. High-level design

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser (React — app/page.tsx)                                       │
│  sign in · search+add · ranked "needs attention" · news · mark read  │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTPS / JSON
                ▼
┌────────────────────────────────────────────────────────────────────┐
│ Next.js API routes (app/api/*)                                       │
│  /session  /watchlist  /seen  /news  /search  /poll                  │
│      │                                                               │
│      ├── Change Engine   (lib/change-engine.ts)   ← the core         │
│      ├── Market Adapter  (lib/market/adapter.ts)  ← Yahoo prices,    │
│      │                                              realized vol,     │
│      │                                              avg volume, staleness
│      ├── News reader     (lib/market/news.ts)     ← Google News RSS  │
│      └── Search          (lib/market/search.ts)   ← NSE list + Yahoo │
│      │                                                               │
│      ▼  (Prisma)                                                     │
│ Postgres: User · WatchlistItem · Snapshot(append-only) · NewsItem    │
│           · NewsRead · SymbolMeta                                     │
└───────────────▲──────────────────────────────────────────────────────┘
                │
        Poller (/api/poll) — Vercel Cron + client 30s poll
        Fetches each UNIQUE symbol once, shared by all users
```

**Core ideas to remember**
- **Meaningful = relative:** a move is scored vs the stock's own 3-month volatility (z-score), plus volume anomaly, 52-week breakout, and title-verified news → weighted noisy-OR → threshold `0.25`.
- **Append-only snapshots:** never mutate a price row; "what changed since last checked" is a diff between two immutable rows → race-free.
- **Watermark:** per-user `lastSeenAt` (global) + per-stock `WatchlistItem.seenAt` (set by "mark as read"). A stock's anchor = the later of the two. All server-side → syncs across tabs/devices.
- **Scale:** poll each unique symbol once (O(unique symbols)); stateless sessions; reads from cached snapshots.

---

## 2. Repo / file map

```
app/page.tsx            UI: auth, autocomplete, ranked lists, news panels, mark-read
app/layout.tsx          page metadata
app/api/session/route   sign up / sign in (handle+PIN) / sign out
app/api/watchlist/route GET dashboard · POST add (validates) · DELETE remove
app/api/seen/route       POST mark-all-seen (no body) OR mark-one ({symbol})
app/api/news/route       GET per-stock news · POST mark news item read
app/api/search/route     GET autocomplete suggestions
app/api/poll/route       Cron: refresh snapshots + news for all unique symbols

lib/change-engine.ts    scoring: 4 signals, volatility prior, noisy-OR (PURE, testable)
lib/market/adapter.ts   Yahoo v8/chart → price, realized volatility, avg volume, staleness
lib/market/news.ts      Google News RSS reader + isRelevantNews (title filter)
lib/market/search.ts    autocomplete: local NSE list + Yahoo augment
lib/market/nse-symbols.ts  bundled ~120 NSE names for instant prefix search
lib/news.ts             getStockNews (7-day window, per-user read) + markNewsRead
lib/watchlist.ts        service layer: snapshots, news refresh, buildDashboard, watermarks
lib/session.ts          handle + scrypt PIN, stateless cookie
lib/prisma.ts           Prisma client singleton
lib/types.ts            Quote / SymbolChange types
prisma/schema.prisma    data model
scripts/smoke.ts        `npm run smoke` — proves the engine with no DB/network
```

---

## 3. Environment variables

Local: `.env` (gitignored). Production: set in Vercel project settings.

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon **pooled** URL (`...-pooler...&pgbouncer=true`) — runtime |
| `DIRECT_URL` | Neon **direct** URL (no `-pooler`) — migrations / `db push` |
| `QUOTE_FRESHNESS_TTL_SECONDS` | staleness "delayed" badge threshold (default 60) |
| `NEWS_TTL_MINUTES` | per-symbol news re-fetch throttle (default 15) |

*(Get the Neon URLs from https://neon.tech → your project → Connect. `.env.example` shows the format.)*

---

## 4. Run locally

```bash
cp .env.example .env      # fill DATABASE_URL + DIRECT_URL
npm install
npm run db:push           # sync schema to the DB
npm run dev               # http://localhost:3000
npm run smoke             # optional: engine sanity check (no DB/network needed)
```

---

## 5. When & how to UPDATE the live app

**Deployment is manual via the Vercel CLI** (not auto — the GitHub repo isn't connected to Vercel yet). So: **editing code or pushing to GitHub does NOT change the live site.** You must deploy.

### The gotcha (read this first)
- Local Node is **18**, but the current Vercel CLI needs **Node 20**. A portable Node 20 lives at `/tmp/node20` (may be gone after a reboot — re-download if so, see below).
- npm is pointed at the **public registry** via the repo's `.npmrc` (avoids Amazon CodeArtifact auth errors).

### Deploy steps
```bash
cd /Users/saidesar/groww-smart-watchlist

# 1. verify it builds
npm run build

# 2. deploy to production (Node 20 + Vercel token)
export PATH=/tmp/node20/bin:$PATH
export VERCEL_TOKEN=<your-vercel-token>      # create at vercel.com/account/tokens
./node_modules/.bin/vercel deploy --prod --yes --token=$VERCEL_TOKEN
```
The command prints the deploy URL; the stable alias `groww-smart-watchlist-rukmini1.vercel.app` updates automatically.

**If you changed `prisma/schema.prisma`,** run `npm run db:push` **before** deploying (and it auto-runs `prisma generate` on Vercel via the build script).

**If `/tmp/node20` is missing** (after reboot):
```bash
curl -fsSL https://nodejs.org/dist/v20.18.1/node-v20.18.1-darwin-arm64.tar.gz -o /tmp/node20.tar.gz
mkdir -p /tmp/node20 && tar -xzf /tmp/node20.tar.gz -C /tmp/node20 --strip-components=1
```
*(Or install Node 20 via nvm and skip the PATH export.)*

### Push code to GitHub
```bash
git add -A && git commit -m "your message"
git push            # needs a GitHub token/credential; the repo remote is HTTPS
```

### Refresh the submission zip (if ever needed)
```bash
rm -f ~/Desktop/groww-smart-watchlist-source.zip
zip -rq ~/Desktop/groww-smart-watchlist-source.zip . \
  -x "node_modules/*" ".next/*" ".git/*" ".vercel/*" "*.log" ".env" "tsconfig.tsbuildinfo"
```

**Golden rule:** live app changes **only** when you run the `vercel deploy` command. GitHub + zip are separate; keep all three in sync after a change (deploy, `git push`, re-zip).

---

## 6. Data flow (for debugging)

**Read (page load / every 30s):**
`GET /api/watchlist` → `buildDashboard(userId)` →
for each watched symbol: latest snapshot + baseline snapshot at its anchor + news since anchor + daily returns → `scoreSymbol()` → ranked `changes` / `quiet`.

**Write (poll):**
`GET /api/poll` → distinct watched symbols → `refreshSnapshots()` →
`getQuotes()` (Yahoo, per-symbol, parallel) → append `Snapshot` rows → `refreshNewsForSymbol()` (throttled `NEWS_TTL_MINUTES`, title-filtered) → upsert `NewsItem`.

**Mark as read:**
- Card: `POST /api/seen {symbol}` → `WatchlistItem.seenAt = now` → stock drops to "quiet" on next fetch (synced).
- News item: `POST /api/news {newsItemId}` → `NewsRead` row → hidden for that user everywhere.

---

## 7. Config knobs (where to tune behaviour)

| Want to change… | File / value |
|---|---|
| Meaningful threshold | `lib/change-engine.ts` → `MEANINGFUL = 0.25` |
| Price-signal sensitivity | `change-engine.ts` → `if (z >= 0.75)` and `clamp01(z / 2)` |
| Signal weights | `change-engine.ts` → `WEIGHTS` |
| Volatility window | `lib/market/adapter.ts` → `range=3mo` |
| Upstream timeout | `adapter.ts` → `AbortSignal.timeout(6000)` |
| News panel window | `lib/news.ts` → `7 * 24 * 3600 * 1000` (7 days) |
| New-user default watermark | `lib/session.ts` → `Date.now() - 24 * 3600 * 1000` |
| Staleness badge / news throttle | env: `QUOTE_FRESHNESS_TTL_SECONDS`, `NEWS_TTL_MINUTES` |
| Autocomplete stock list | `lib/market/nse-symbols.ts` |

---

## 8. Debugging playbook (symptom → cause → fix)

| Symptom | Likely cause | Fix |
|---|---|---|
| **Everything in "Everything else", nothing flagged** | Market closed (prices frozen) OR watermark just advanced → no change since it | Expected. On a fresh account (watermark 24h back) today's movers flag via day-change fallback. Not a bug. |
| **Prices show as `mock` / no data** | Yahoo unreachable from the host (or symbol invalid) | On failure we omit + keep last snapshot; check `/api/poll` response `sources`. Verify Yahoo `v8/chart/<SYM>.NS` works. |
| **Autocomplete empty for 1–2 letters** | Query not in bundled list; Yahoo needs 3+ chars | Add the name to `lib/market/nse-symbols.ts`, or type 3+ letters. |
| **A wrong company's news appears** | Pre-filter row, or title lacks the name | `isRelevantNews` filters at insert, engine, and panel — confirm the title actually names the company. |
| **"delayed" badge everywhere** | Poller not running (free-tier cron is daily) | Hit `/api/poll` manually, or keep a tab open (client polls every 30s), or add a 1-min external pinger. |
| **Mark-as-read not syncing across tabs** | (Fixed) was client-only; now `WatchlistItem.seenAt` server-side | Ensure `/api/seen {symbol}` is called; other tabs update on next 30s poll. |
| **`db push` / migrations fail** | Using pooled URL for DDL | Ensure `DIRECT_URL` (no `-pooler`) is set; Prisma uses it for migrations. |
| **Deploy fails "CLI version outdated"** | Vercel CLI needs Node 20 | Use `/tmp/node20/bin` on PATH (see §5). |
| **`npm install` 401 / edgesOut** | npm pointed at Amazon CodeArtifact | Repo `.npmrc` forces public registry; or `--registry https://registry.npmjs.org/`. |

**Quick health check (any time):**
```bash
U=https://groww-smart-watchlist-rukmini1.vercel.app
curl -s $U/api/poll                     # {"polled":N,"sources":{"yahoo":N}}
curl -s "$U/api/search?q=reli"          # autocomplete
```

---

## 9. Known limitations / next steps (by design)

- **Conflicting data:** single authoritative source (Yahoo) + freshest-wins; multi-source reconciliation is the next step (add a 2nd feed + a "sources disagree" flag).
- **Auth:** handle + PIN, plaintext session cookie; no "forgot PIN" (no email/phone). Production: signed/encrypted session token + email OTP reset.
- **Real-time:** 30s poll, not websockets. Add SSE / a realtime service if needed.
- **Read path N+1:** `buildDashboard` queries per symbol; batch into grouped `WHERE symbol IN (...)` at large watchlists.
- **Snapshot growth:** append-only; add time-based retention/partitioning.
- **Cron:** Vercel free tier = daily; Pro or an external 1-min pinger for minute-level polling.

---

## 10. One-line mental model
> It fetches each stock once for everyone, scores every move against that stock's *own* normal behaviour, and shows you only what genuinely changed since you last looked — all server-side, so it stays consistent across your devices.
