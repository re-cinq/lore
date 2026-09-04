import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

/** The signed-in user's GitHub access token, or null when there is no session — the first rung of every proxy route's auth ladder. */
export async function resolveSessionAccessToken(): Promise<string | null> {
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
  } | null;

  return session?.accessToken ?? null;
}
