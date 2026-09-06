import { prisma } from "@/lib/prisma";

const NAME_STOP = new Set([
  "ltd", "limited", "india", "the", "co", "corporation", "company",
  "industries", "enterprises", "&",
]);

// Keep a headline only if it actually names the company — ticker as a whole
// word, or a distinctive word from its name. Applied at read time so even
// older, loosely-matched rows are hidden.
export function isRelevantNews(title: string, name: string | null, symbol: string): boolean {
  const t = title.toLowerCase();
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${esc}\\b`, "i").test(title)) return true;
  const tokens = (name ?? "")
    .toLowerCase()
    .replace(/[.,()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !NAME_STOP.has(w));
  return tokens.some((tok) => t.includes(tok));
}

export type StockNewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

// Recent news for one stock, EXCLUDING items this user has marked read. Read
// state is per-user (NewsRead), so a dismissal persists across the user's
// sessions/devices without hiding the shared item from other users.
export async function getStockNews(
  userId: string,
  symbol: string
): Promise<StockNewsItem[]> {
  const sym = symbol.trim().toUpperCase();

  // The browse panel shows RECENT news only — a rolling 7-day window — so it's
  // never weeks/months old but still has content on a quiet day. (The "since
  // you last checked" watermark logic drives the attention *alerts*, not this
  // browse list.)
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [meta, reads] = await Promise.all([
    prisma.symbolMeta.findUnique({ where: { symbol: sym }, select: { name: true } }),
    prisma.newsRead.findMany({ where: { userId }, select: { newsItemId: true } }),
  ]);
  const readIds = reads.map((r) => r.newsItemId);

  const rows = await prisma.newsItem.findMany({
    where: {
      symbol: sym,
      publishedAt: { gte: since },
      ...(readIds.length ? { id: { notIn: readIds } } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: 30,
  });
  // Read-time relevance guard hides older, loosely-matched rows.
  const items = rows
    .filter((n) => isRelevantNews(n.title, meta?.name ?? null, sym))
    .slice(0, 15);

  return items.map((n) => ({
    id: n.id,
    title: n.title,
    url: n.url,
    source: n.source,
    publishedAt: n.publishedAt.toISOString(),
  }));
}

// Mark a news item read for this user (idempotent) — persists the dismissal.
export async function markNewsRead(userId: string, newsItemId: string) {
  await prisma.newsRead.upsert({
    where: { userId_newsItemId: { userId, newsItemId } },
    update: {},
    create: { userId, newsItemId },
  });
}
