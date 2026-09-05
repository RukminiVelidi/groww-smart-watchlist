import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { brokerCatalog } from "@/lib/brokers";
import {
  connectBroker,
  syncBroker,
  disconnectBroker,
  brokerStatus,
} from "@/lib/broker-service";

// Importing holdings warms quotes + first news per symbol — can exceed the
// default serverless cap.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Catalog of supported brokers (safe metadata) + this user's connection status.
export async function GET() {
  const userId = await currentUserId();
  const status = userId ? await brokerStatus(userId) : null;
  return NextResponse.json({ catalog: brokerCatalog(), status });
}

export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const body = await req.json();
  try {
    if (body.action === "connect") {
      const result = await connectBroker(userId, body.broker, body.creds ?? {});
      return NextResponse.json({ ...result, status: await brokerStatus(userId) });
    }
    if (body.action === "sync") {
      const result = await syncBroker(userId);
      return NextResponse.json({ ...(result ?? { imported: 0, symbols: [] }), status: await brokerStatus(userId) });
    }
    if (body.action === "disconnect") {
      await disconnectBroker(userId);
      return NextResponse.json({ ok: true, status: null });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    // Surface the adapter's message (e.g. "token expired") to the UI.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "broker error" },
      { status: 400 }
    );
  }
}
