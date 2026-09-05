import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { markSeen, buildDashboard } from "@/lib/watchlist";

// Advance the "last checked" watermark. Explicit user action, single atomic
// write — see markSeen() for the race-condition reasoning.
export async function POST() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  await markSeen(userId);
  return NextResponse.json(await buildDashboard(userId));
}
