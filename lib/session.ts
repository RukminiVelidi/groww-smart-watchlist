import { cookies } from "next/headers";
import { getOrCreateUser } from "@/lib/watchlist";

const COOKIE = "gw_handle";

// Resolve the current user from the handle cookie. Signing in with the same
// handle on any device returns the same user -> state persists across devices.
export async function currentUserId(): Promise<string | null> {
  const handle = cookies().get(COOKIE)?.value;
  if (!handle) return null;
  const user = await getOrCreateUser(handle);
  return user.id;
}

export async function signIn(handle: string) {
  const user = await getOrCreateUser(handle);
  cookies().set(COOKIE, user.handle, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return user;
}

export function currentHandle(): string | null {
  return cookies().get(COOKIE)?.value ?? null;
}
