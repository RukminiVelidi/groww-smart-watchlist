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

export async function GET() {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  return NextResponse.json(await buildDashboard(userId));
}

export async function POST(req: NextRequest) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { symbol } = await req.json();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const result = await addSymbol(userId, symbol);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
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
