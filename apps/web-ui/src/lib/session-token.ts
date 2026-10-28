import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session-cookie-options";

/** The signed-in person's lore-api session token, or null when there is no session. The one place a request's credentials are read. */
export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}
