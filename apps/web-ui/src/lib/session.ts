import { getMe } from "@/lib/api/auth";

/** The signed-in person as the UI shows and names them. */
export interface Session {
  login: string;
  user: { name: string; image: string | null };
  /** When the person signed in, and when that sign-in stops working. */
  startedAt: string;
  expiresAt: string | null;
}

/** The person behind the session cookie, or null when there is no session or lore-api does not know the token. */
export async function getSession(): Promise<Session | null> {
  const me = await getMe();

  return me.status === "ok"
    ? {
        login: me.data.login,
        user: { name: me.data.name, image: me.data.avatar_url },
        startedAt: me.data.started_at,
        expiresAt: me.data.expires_at,
      }
    : null;
}
