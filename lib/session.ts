import { cookies } from "next/headers";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

const COOKIE = "gw_handle";

// PIN hashing — salted scrypt. We store `salt:hash`, never the PIN.
function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${dk}`;
}
function verifyPin(pin: string, stored: string): boolean {
  const [salt, dk] = stored.split(":");
  if (!salt || !dk) return false;
  const want = Buffer.from(dk, "hex");
  const got = scryptSync(pin, salt, 32);
  return want.length === got.length && timingSafeEqual(want, got);
}

// Resolve the current user from the handle cookie (already authenticated at
// sign-in). Returns null if the cookie is missing or the user no longer exists.
export async function currentUserId(): Promise<string | null> {
  const handle = cookies().get(COOKIE)?.value;
  if (!handle) return null;
  const user = await prisma.user.findUnique({ where: { handle } });
  return user?.id ?? null;
}

export function currentHandle(): string | null {
  return cookies().get(COOKIE)?.value ?? null;
}

// Sign in / sign up with handle + PIN, with an explicit mode so the UI can give
// clear feedback:
//  - signup: handle must be free; creates the account and sets the PIN.
//  - signin: handle must exist; PIN must match (a legacy handle with no PIN yet
//            adopts the one entered).
export async function signIn(
  handle: string,
  pin: string,
  mode: "signin" | "signup"
): Promise<{ ok: boolean; error?: string }> {
  const clean = handle.trim().toLowerCase();
  if (!clean) return { ok: false, error: "Enter a handle." };
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "PIN must be 4–6 digits." };

  const existing = await prisma.user.findUnique({ where: { handle: clean } });

  if (mode === "signup") {
    if (existing) {
      return { ok: false, error: `"${clean}" is already taken — choose a different handle.` };
    }
    await prisma.user.create({
      data: {
        handle: clean,
        pinHash: hashPin(pin),
        lastSeenAt: new Date(Date.now() - 24 * 3600 * 1000),
      },
    });
  } else {
    if (!existing) {
      return { ok: false, error: `No account for "${clean}". Switch to Sign up to create it.` };
    }
    if (!existing.pinHash) {
      await prisma.user.update({ where: { id: existing.id }, data: { pinHash: hashPin(pin) } });
    } else if (!verifyPin(pin, existing.pinHash)) {
      return { ok: false, error: "Incorrect PIN." };
    }
  }

  cookies().set(COOKIE, clean, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}

export function signOut() {
  cookies().delete(COOKIE);
}
