import { NextRequest, NextResponse } from "next/server";
import { signIn, signOut, currentHandle } from "@/lib/session";

export async function GET() {
  return NextResponse.json({ handle: currentHandle() });
}

// Sign in / sign up with handle + PIN.
export async function POST(req: NextRequest) {
  const { handle, pin } = await req.json();
  if (!handle || typeof handle !== "string" || !handle.trim()) {
    return NextResponse.json({ error: "handle required" }, { status: 400 });
  }
  const result = await signIn(handle, String(pin ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
  return NextResponse.json({ handle: handle.trim().toLowerCase() });
}

// Sign out — clears the handle cookie.
export async function DELETE() {
  signOut();
  return NextResponse.json({ ok: true });
}
