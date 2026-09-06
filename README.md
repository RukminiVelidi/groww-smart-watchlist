# Smart Market Watchlist

A watchlist that answers what a live-price list can't: **"what meaningfully
changed since I last looked, and what deserves my attention first?"** — decided
automatically, per stock, with zero alert configuration.

**Live:** https://groww-smart-watchlist-rukmini1.vercel.app
**Design & decisions:** [DESIGN.md](./DESIGN.md)

---

## What it does

- **Create & manage a watchlist** — search a company (autocomplete) and add it.
- **See what changed since you last checked** — a ranked *"Needs your attention"*
  list of meaningful moves, each with a plain-English reason (e.g. *"↑4% since
  you last checked — 1.3× its typical daily move"*), above the quiet rest.
- **Meaningful = relative to each stock** — moves are scored against the stock's
  own volatility and average volume, plus 52-week breakouts and fresh news.
- **Per-stock news** — recent headlines you can mark read (persists per user).
- **Persists across devices** — sign in with the same handle + PIN anywhere.

All market data is real (Yahoo Finance + Google News); nothing is fabricated.

---

## Run it

Requirements: Node 18+, a free Postgres URL (https://neon.tech).

```bash
cp .env.example .env      # paste your Postgres URL into DATABASE_URL and DIRECT_URL
npm install
npm run db:push           # create the schema
npm run dev               # http://localhost:3000

npm run smoke             # optional: proves the change engine with no DB/network
```

Sign up with a **handle + PIN** (a new handle sets its PIN; returning needs it).
Search a stock to add it. Return later — meaningful changes are ranked at the
top; **Mark all as seen** advances your baseline.

---

## Stack

Next.js (React UI + API routes) · Prisma + PostgreSQL (Neon) · Tailwind ·
deployed on Vercel (+ Cron). Data: Yahoo Finance, Google News RSS — free, no keys.

See **[DESIGN.md](./DESIGN.md)** for the architecture, the meaningful-change
engine, how each brief requirement was handled, and the trade-offs.
