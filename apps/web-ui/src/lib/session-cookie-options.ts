/** The cookie that holds the person's lore-api session token (ADR-053). */
export const SESSION_COOKIE = "lore_session";

/** The cookie lives exactly as long as the token it carries, so an expired token is never sent. It is Secure on an https origin; a local UI over plain http could not keep it otherwise. */
export function sessionCookieOptions(expiresAt: Date, origin: string) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: origin.startsWith("https:"),
    path: "/",
    expires: expiresAt,
  };
}
