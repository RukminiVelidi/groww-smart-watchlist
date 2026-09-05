import { prisma } from "@/lib/prisma";
import { getBroker } from "@/lib/brokers";
import { addSymbols } from "@/lib/watchlist";

// Connect a broker: fetch the user's real holdings via the broker's adapter,
// add them to the watchlist, and persist the connection so we can re-sync.
export async function connectBroker(
  userId: string,
  brokerId: string,
  creds: Record<string, string>
): Promise<{ imported: number; symbols: string[] }> {
  const adapter = getBroker(brokerId);
  if (!adapter) throw new Error(`Unknown broker: ${brokerId}`);

  const holdings = await adapter.getHoldings(creds); // throws on bad token
  const symbols = holdings.map((h) => h.symbol);
  const added = await addSymbols(userId, symbols);

  await prisma.brokerConnection.upsert({
    where: { userId },
    update: {
      broker: brokerId,
      accessToken: creds.accessToken ?? "",
      clientId: creds.clientId ?? null,
      lastSyncAt: new Date(),
    },
    create: {
      userId,
      broker: brokerId,
      accessToken: creds.accessToken ?? "",
      clientId: creds.clientId ?? null,
      lastSyncAt: new Date(),
    },
  });

  return { imported: added.length, symbols: added };
}

// Re-sync: pull holdings again and add any newly-bought symbols. This is the
// "new investments appear automatically" path — call it from a button now, and
// from the existing poll cron in production.
export async function syncBroker(
  userId: string
): Promise<{ imported: number; symbols: string[] } | null> {
  const conn = await prisma.brokerConnection.findUnique({ where: { userId } });
  if (!conn) return null;
  const adapter = getBroker(conn.broker);
  if (!adapter) return null;

  const holdings = await adapter.getHoldings({
    accessToken: conn.accessToken,
    clientId: conn.clientId ?? "",
  });
  const added = await addSymbols(
    userId,
    holdings.map((h) => h.symbol)
  );
  await prisma.brokerConnection.update({
    where: { userId },
    data: { lastSyncAt: new Date() },
  });
  return { imported: added.length, symbols: added };
}

export async function disconnectBroker(userId: string) {
  await prisma.brokerConnection.deleteMany({ where: { userId } });
}

// Safe status for the UI — never returns the token.
export async function brokerStatus(userId: string) {
  const conn = await prisma.brokerConnection.findUnique({ where: { userId } });
  if (!conn) return null;
  return { broker: conn.broker, lastSyncAt: conn.lastSyncAt?.toISOString() ?? null };
}
