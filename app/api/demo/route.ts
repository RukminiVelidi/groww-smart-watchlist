import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

// Honest demo aids only — these reveal REAL data, they never fabricate it.
//
// POST { action: "rewind", hours }   -> moves the caller's lastSeenAt back, so
//                                       the dashboard surfaces the REAL price
//                                       moves and REAL news since that time.
// POST { action: "stale", symbol, ageMinutes } -> backdates the fetchedAt of a
//                                       real snapshot to demonstrate the real
//                                       staleness badge (no values are faked).
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "rewind") {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
    const hours = Number(body.hours ?? 24);
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date(Date.now() - hours * 3_600_000) },
    });
    return NextResponse.json({ ok: true, rewoundHours: hours });
  }

  if (body.action === "stale") {
    const symbol = String(body.symbol ?? "").toUpperCase();
    const last = await prisma.snapshot.findFirst({
      where: { symbol },
      orderBy: { fetchedAt: "desc" },
    });
    if (!last) return NextResponse.json({ error: "no snapshot yet" }, { status: 404 });
    await prisma.snapshot.update({
      where: { id: last.id },
      data: { fetchedAt: new Date(Date.now() - Number(body.ageMinutes ?? 30) * 60_000) },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
