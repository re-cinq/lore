// What the live socket's upgrade reads of a browser: the session cookie, and whether the page that opened the socket may speak for it.

import { returnUrlAllowed } from "../auth/login-grant.js";

const SESSION_COOKIE = "lore_session";

/** The session token in a raw `Cookie` header, read by hand so a malformed neighbour cookie cannot throw. */
export function sessionCookieOf(
  header: string | undefined,
): string | undefined {
  const prefix = `${SESSION_COOKIE}=`;
  const found = header
    ?.split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(prefix));

  return found?.slice(prefix.length) || undefined;
}

/** The pages the login route already sends a person back to: the UI's own origin, or a local UI over http. */
export function originAllowed(
  origin: string | undefined,
  env: { LORE_UI_URL?: string } = process.env,
): boolean {
  return origin !== undefined && returnUrlAllowed(origin, env);
}

/** The part of a signed-in person a channel's admission reads: the repositories their session may open. */
export interface SocketPerson {
  login: string;
  repos: string[];
}

/** Who the socket's session cookie names, asked at the moment a channel opens. */
export interface SessionAccess {
  person(): Promise<SocketPerson | null>;
}

export const NO_SESSION: SessionAccess = { person: async () => null };
