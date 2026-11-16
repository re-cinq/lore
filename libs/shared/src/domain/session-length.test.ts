import { describe, expect, it } from "vitest";
import { sessionLengthError, sessionLengthMs } from "./session-length.js";

const HOUR_MS = 60 * 60 * 1000;

describe("sessionLengthMs", () => {
  it("gives 8 hours when no length is saved", () => {
    expect(sessionLengthMs(undefined)).toBe(8 * HOUR_MS);
  });

  it("gives 168 hours for a saved 168", () => {
    expect(sessionLengthMs("168")).toBe(168 * HOUR_MS);
  });

  it("gives 8 hours for a saved 5, which the settings page never offers", () => {
    expect(sessionLengthMs("5")).toBe(8 * HOUR_MS);
  });
});

describe("sessionLengthError", () => {
  it("refuses session_length_hours 5 and names the lengths on offer", () => {
    expect(sessionLengthError("session_length_hours", "5")).toBe(
      "session_length_hours must be 8, 24, 168 or 720",
    );
  });

  it("accepts session_length_hours 720", () => {
    expect(sessionLengthError("session_length_hours", "720")).toBeNull();
  });

  it("accepts a blank session_length_hours, the form's leave it alone", () => {
    expect(sessionLengthError("session_length_hours", "")).toBeNull();
  });

  it("accepts any value of another key", () => {
    expect(sessionLengthError("api_url", "5")).toBeNull();
  });
});
