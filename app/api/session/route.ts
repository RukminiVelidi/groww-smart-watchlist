import { NextRequest, NextResponse } from "next/server";
import { signIn, currentHandle } from "@/lib/session";

export async function GET() {
  return NextResponse.json({ handle: currentHandle() });
}

export async function POST(req: NextRequest) {
  const { handle } = await req.json();
  if (!handle || typeof handle !== "string" || !handle.trim()) {
    return NextResponse.json({ error: "handle required" }, { status: 400 });
  }
  const user = await signIn(handle);
  return NextResponse.json({ handle: user.handle });
}
