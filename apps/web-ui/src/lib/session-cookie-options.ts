/** The cookie that holds the person's lore-api session token (ADR-053). */
export const SESSION_COOKIE = "lore_session";

/** The cookie lives exactly as long as the token it carries, so an expired token is never sent. */
export function sessionCookieOptions(expiresAt: Date, secure: boolean) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/",
    expires: expiresAt,
  };
}
