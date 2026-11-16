import { describe, it, expect } from "vitest";
import { sessionAnswer } from "./session-answer";

describe("sessionAnswer", () => {
  it("answers signed in with the session's end for a person lore-api knows", () => {
    expect(
      sessionAnswer({
        status: "ok",
        data: {
          login: "gedaiu",
          name: "Bogdan",
          avatar_url: null,
          scopes: ["admin"],
          started_at: "2026-10-28T10:00:00.000Z",
          expires_at: "2026-10-28T18:00:00.000Z",
        },
      }),
    ).toEqual({
      status: 200,
      body: { signed_in: true, expires_at: "2026-10-28T18:00:00.000Z" },
    });
  });

  it("answers signed out when the browser sent no session cookie", () => {
    expect(sessionAnswer({ status: "unconfigured" })).toEqual({
      status: 200,
      body: { signed_in: false, expires_at: null },
    });
  });

  it("answers signed out when lore-api answers 401 for the token", () => {
    expect(
      sessionAnswer({ status: "error", message: "invalid token", code: 401 }),
    ).toEqual({
      status: 200,
      body: { signed_in: false, expires_at: null },
    });
  });

  it("answers 503 when lore-api could not be reached, which says nothing about the session", () => {
    expect(sessionAnswer({ status: "error", message: "fetch failed" })).toEqual(
      { status: 503, body: { error: "fetch failed" } },
    );
  });
});
