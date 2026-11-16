import { describe, it, expect } from "vitest";
import { originAllowed, sessionCookieOf } from "./socket-session.js";

describe("sessionCookieOf", () => {
  it("finds the session in a Cookie header that holds three cookies", () => {
    expect(
      sessionCookieOf("theme=dark; lore_session=abc123; other=%E0%A4%A"),
    ).toEqual("abc123");
  });

  it("answers undefined for a header with no lore_session", () => {
    expect(sessionCookieOf("theme=dark; lore_session_old=x")).toBeUndefined();
  });

  it("answers undefined for a missing header", () => {
    expect(sessionCookieOf(undefined)).toBeUndefined();
  });
});

describe("originAllowed", () => {
  const env = { LORE_UI_URL: "https://lore.gcp.re-cinq.com" };

  it("allows the UI's origin and a local one, and refuses another site, the string null and no origin", () => {
    const origins = [
      "https://lore.gcp.re-cinq.com",
      "http://localhost:3000",
      "https://evil.example",
      "null",
      undefined,
    ];

    expect(origins.map((origin) => originAllowed(origin, env))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
