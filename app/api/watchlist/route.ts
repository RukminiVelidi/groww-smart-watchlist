import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { addSymbol, removeSymbol, buildDashboard } from "@/lib/watchlist";

// Adding a symbol warms its quote + first news fetch, which can exceed the
// default serverless cap.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireUser() {
  const userId = await currentUserId();
  if (!userId) return null;
  return userId;
}

export async function GET(req: NextRequest) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const sinceParam = new URL(req.url).searchParams.get("since");
  const sinceHours = sinceParam ? Number(sinceParam) : undefined;
  return NextResponse.json(
    await buildDashboard(userId, Number.isFinite(sinceHours) ? sinceHours : undefined)
  );
}

export async function POST(req: NextRequest) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { symbol } = await req.json();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  await addSymbol(userId, symbol);
  return NextResponse.json(await buildDashboard(userId));
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { symbol } = await req.json();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  await removeSymbol(userId, symbol);
  return NextResponse.json(await buildDashboard(userId));
}
