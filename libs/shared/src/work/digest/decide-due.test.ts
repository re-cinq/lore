import { describe, it, expect } from "vitest";
import { DIGEST_DEFAULTS } from "../../domain/digest-settings.js";
import { decideDigestDue, localParts } from "./decide-due.js";

const friday0905Berlin = new Date("2026-09-25T07:05:00Z");
const enabled = { ...DIGEST_DEFAULTS, enabled: true };

describe("decideDigestDue", () => {
  it("returns false when disabled", () => {
    expect(
      decideDigestDue({
        settings: DIGEST_DEFAULTS,
        now: friday0905Berlin,
        lastPostedAt: null,
      }),
    ).toBe(false);
  });

  it("returns true at 09:05 Berlin on a weekday with no prior post", () => {
    expect(
      decideDigestDue({
        settings: enabled,
        now: friday0905Berlin,
        lastPostedAt: null,
      }),
    ).toBe(true);
  });

  it("returns false before the scheduled time", () => {
    expect(
      decideDigestDue({
        settings: enabled,
        now: new Date("2026-09-25T06:55:00Z"),
        lastPostedAt: null,
      }),
    ).toBe(false);
  });

  it("returns false on a weekday not in days", () => {
    expect(
      decideDigestDue({
        settings: { ...enabled, days: [1, 2, 3, 4] },
        now: friday0905Berlin,
        lastPostedAt: null,
      }),
    ).toBe(false);
  });

  it("returns false when already posted today in the repo's timezone", () => {
    expect(
      decideDigestDue({
        settings: enabled,
        now: new Date("2026-09-25T15:00:00Z"),
        lastPostedAt: friday0905Berlin,
      }),
    ).toBe(false);
  });

  it("returns true when the last post was yesterday", () => {
    expect(
      decideDigestDue({
        settings: enabled,
        now: friday0905Berlin,
        lastPostedAt: new Date("2026-09-24T07:05:00Z"),
      }),
    ).toBe(true);
  });

  it("returns true on Monday 2026-10-26 at 08:05Z, which is 09:05 Berlin after the clocks went back", () => {
    expect(
      decideDigestDue({
        settings: enabled,
        now: new Date("2026-10-26T08:05:00Z"),
        lastPostedAt: new Date("2026-10-23T07:05:00Z"),
      }),
    ).toBe(true);
  });
});

describe("localParts", () => {
  it("returns the local date, JS weekday and HH:MM in the timezone", () => {
    expect(localParts(new Date("2026-09-25T22:30:00Z"), "Asia/Tokyo")).toEqual(
      { date: "2026-09-26", weekday: 6, hhmm: "07:30" },
    );
  });
});
