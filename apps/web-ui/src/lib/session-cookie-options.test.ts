import { describe, it, expect } from "vitest";
import { SESSION_COOKIE, sessionCookieOptions } from "./session-cookie-options";

describe("sessionCookieOptions", () => {
  const expiresAt = new Date("2026-10-28T18:00:00Z");

  it("keeps the session token out of scripts, on this site only, until the token expires", () => {
    expect(sessionCookieOptions(expiresAt, "https://lore.example")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: expiresAt,
    });
  });

  it("allows the cookie over plain http for a local UI", () => {
    expect(
      sessionCookieOptions(expiresAt, "http://localhost:3000").secure,
    ).toBe(false);
  });

  it("names the cookie lore_session", () => {
    expect(SESSION_COOKIE).toBe("lore_session");
  });
});
