import { describe, expect, it } from "vitest";
import {
  sessionEnded,
  sessionLengthLabel,
  signInAgainPath,
  timerDelayMs,
} from "./session-expiry";

const at = (time: string) => new Date(time).getTime();

describe("sessionEnded", () => {
  it("is false at 17:59 for a session that ends at 18:00", () => {
    expect(
      sessionEnded("2026-10-28T18:00:00.000Z", at("2026-10-28T17:59:00Z")),
    ).toBe(false);
  });

  it("is true at 18:00 for a session that ends at 18:00", () => {
    expect(
      sessionEnded("2026-10-28T18:00:00.000Z", at("2026-10-28T18:00:00Z")),
    ).toBe(true);
  });

  it("is false for a session with no end", () => {
    expect(sessionEnded(null, at("2026-10-28T18:00:00Z"))).toBe(false);
  });
});

describe("timerDelayMs", () => {
  it("waits 60000 ms at 17:59 for a session that ends at 18:00", () => {
    expect(
      timerDelayMs("2026-10-28T18:00:00.000Z", at("2026-10-28T17:59:00Z")),
    ).toBe(60_000);
  });

  it("waits 2147483647 ms, the longest a browser timer runs, for a session that ends in 30 days", () => {
    expect(
      timerDelayMs("2026-11-27T10:00:00.000Z", at("2026-10-28T10:00:00Z")),
    ).toBe(2_147_483_647);
  });

  it("waits 0 ms for a session that already ended", () => {
    expect(
      timerDelayMs("2026-10-28T18:00:00.000Z", at("2026-10-28T19:00:00Z")),
    ).toBe(0);
  });
});

describe("signInAgainPath", () => {
  it("names the page and its query as the page to come back to", () => {
    expect(signInAgainPath("/repos/re-cinq/lore/loops", "?loop=review")).toBe(
      "/auth/signin?next=%2Frepos%2Fre-cinq%2Flore%2Floops%3Floop%3Dreview",
    );
  });
});

describe("sessionLengthLabel", () => {
  it("says 8 hours for a session from 10:00 to 18:00", () => {
    expect(
      sessionLengthLabel(
        "2026-10-28T10:00:00.000Z",
        "2026-10-28T18:00:00.000Z",
      ),
    ).toBe("8 hours");
  });

  it("says 1 day for a session of 24 hours", () => {
    expect(
      sessionLengthLabel(
        "2026-10-28T10:00:00.000Z",
        "2026-10-29T10:00:00.000Z",
      ),
    ).toBe("1 day");
  });

  it("says 7 days for a session of 168 hours", () => {
    expect(
      sessionLengthLabel(
        "2026-10-28T10:00:00.000Z",
        "2026-11-04T10:00:00.000Z",
      ),
    ).toBe("7 days");
  });
});
