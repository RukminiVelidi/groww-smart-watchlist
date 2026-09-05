// Real news source: Google News RSS. No API key, returns timestamped headlines
// from real publishers, reachable server-side. We query by the company's real
// name (resolved from the price vendor) for relevance, and parse the RSS with a
// small dependency-free reader — an item published since the user's last visit
// becomes a meaningful EVENT signal.

export type NewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;|&#39;/gi, (m) => ENTITIES[m] ?? m)
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return null;
  return decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, ""));
}

export async function fetchNews(query: string, limit = 8): Promise<NewsItem[]> {
  const q = encodeURIComponent(`${query} share price`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`GoogleNews ${res.status}`);

  const xml = await res.text();
  const items: NewsItem[] = [];
  const blocks = xml.split(/<item>/).slice(1);
  for (const raw of blocks) {
    const block = raw.split("</item>")[0];
    const title = tag(block, "title");
    const link = tag(block, "link");
    const pub = tag(block, "pubDate");
    const source = tag(block, "source") ?? "News";
    if (!title || !link || !pub) continue;
    const publishedAt = new Date(pub);
    if (Number.isNaN(publishedAt.getTime())) continue;
    items.push({ title, url: link, source, publishedAt });
    if (items.length >= limit) break;
  }
  return items;
}
