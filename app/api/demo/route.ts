import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Demo control surface — lets us deterministically script the two hardest
// things to show live: (1) a meaningful price/volume move, and (2) a corporate
// event landing "since you last checked". Not part of the product; a demo aid.
//
// POST { action: "spike", symbol, changePct?, volumeMult? }
// POST { action: "event", symbol, type?, headline? }
// POST { action: "stale", symbol, ageMinutes }   -> backdates last snapshot
export async function POST(req: NextRequest) {
  const body = await req.json();
  const symbol = String(body.symbol ?? "").toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  if (body.action === "event") {
    await prisma.corporateEvent.create({
      data: {
        symbol,
        type: body.type ?? "RESULT",
        headline: body.headline ?? `${symbol} quarterly results announced`,
        occurredAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "spike") {
    const last = await prisma.snapshot.findFirst({
      where: { symbol },
      orderBy: { fetchedAt: "desc" },
    });
    if (!last) return NextResponse.json({ error: "no snapshot yet" }, { status: 404 });
    const changePct = Number(body.changePct ?? 6);
    const volumeMult = Number(body.volumeMult ?? 3);
    const price = +(last.prevClose * (1 + changePct / 100)).toFixed(2);
    await prisma.snapshot.create({
      data: {
        symbol,
        price,
        prevClose: last.prevClose,
        dayChangePct: changePct,
        dayHigh: price,
        dayLow: last.dayLow,
        volume: (last.avgVolume ?? 1_000_000) * volumeMult,
        avgVolume: last.avgVolume,
        week52High: last.week52High,
        week52Low: last.week52Low,
        marketCap: last.marketCap,
        upperCircuit: last.upperCircuit,
        lowerCircuit: last.lowerCircuit,
        source: "demo",
      },
    });
    return NextResponse.json({ ok: true, price });
  }

  if (body.action === "stale") {
    const last = await prisma.snapshot.findFirst({
      where: { symbol },
      orderBy: { fetchedAt: "desc" },
    });
    if (!last) return NextResponse.json({ error: "no snapshot yet" }, { status: 404 });
    const ageMinutes = Number(body.ageMinutes ?? 30);
    await prisma.snapshot.update({
      where: { id: last.id },
      data: { fetchedAt: new Date(Date.now() - ageMinutes * 60_000) },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
