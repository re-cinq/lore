import { describe, it, expect } from "vitest";
import {
  RELEASE_DEFAULTS,
  type ResolvedReleaseSettings,
} from "../../domain/release-settings.js";
import { decideReleaseDue } from "./decide-release-due.js";

const mondayBerlin: ResolvedReleaseSettings = {
  ...RELEASE_DEFAULTS,
  enabled: true,
};

describe("decideReleaseDue", () => {
  it("returns false at Monday 09:05 Berlin when the release is disabled", () => {
    expect(
      decideReleaseDue({
        settings: RELEASE_DEFAULTS,
        now: new Date("2026-11-23T08:05:00Z"),
        lastReleasedAt: null,
      }),
    ).toBe(false);
  });

  it("returns true at Monday 09:05 Berlin with no release yet", () => {
    expect(
      decideReleaseDue({
        settings: mondayBerlin,
        now: new Date("2026-11-23T08:05:00Z"),
        lastReleasedAt: null,
      }),
    ).toBe(true);
  });

  it("returns false at Monday 09:05 Berlin when the release ran at 09:01 the same day", () => {
    expect(
      decideReleaseDue({
        settings: mondayBerlin,
        now: new Date("2026-11-23T08:05:00Z"),
        lastReleasedAt: new Date("2026-11-23T08:01:00Z"),
      }),
    ).toBe(false);
  });

  it("returns true at Monday 09:05 Berlin when the last release was the Monday before", () => {
    expect(
      decideReleaseDue({
        settings: mondayBerlin,
        now: new Date("2026-11-23T08:05:00Z"),
        lastReleasedAt: new Date("2026-11-16T08:05:00Z"),
      }),
    ).toBe(true);
  });

  it("returns true at Saturday 01:00 Tokyo while it is still Friday 16:00 in UTC", () => {
    expect(
      decideReleaseDue({
        settings: {
          ...mondayBerlin,
          days: [6],
          time: "00:30",
          timezone: "Asia/Tokyo",
        },
        now: new Date("2026-11-20T16:00:00Z"),
        lastReleasedAt: new Date("2026-11-20T14:50:00Z"),
      }),
    ).toBe(true);
  });

  it("returns false at Saturday 01:00 Tokyo when the release ran at Saturday 00:10 Tokyo, still Friday in UTC", () => {
    expect(
      decideReleaseDue({
        settings: {
          ...mondayBerlin,
          days: [6],
          time: "00:30",
          timezone: "Asia/Tokyo",
        },
        now: new Date("2026-11-20T16:00:00Z"),
        lastReleasedAt: new Date("2026-11-20T15:10:00Z"),
      }),
    ).toBe(false);
  });

  it("returns false at 08:30 Berlin on 2026-10-25, the day the clocks go back, for 09:00", () => {
    expect(
      decideReleaseDue({
        settings: { ...mondayBerlin, days: [0] },
        now: new Date("2026-10-25T07:30:00Z"),
        lastReleasedAt: null,
      }),
    ).toBe(false);
  });

  it("returns true at 09:00 Berlin on 2026-10-25, the day the clocks go back", () => {
    expect(
      decideReleaseDue({
        settings: { ...mondayBerlin, days: [0] },
        now: new Date("2026-10-25T08:00:00Z"),
        lastReleasedAt: null,
      }),
    ).toBe(true);
  });

  it("returns false at 01:59 Berlin on 2026-03-29, the day the clocks go forward, for 02:30", () => {
    expect(
      decideReleaseDue({
        settings: { ...mondayBerlin, days: [0], time: "02:30" },
        now: new Date("2026-03-29T00:59:00Z"),
        lastReleasedAt: null,
      }),
    ).toBe(false);
  });

  it("returns true at 03:00 Berlin on 2026-03-29 for 02:30, a time that day skips", () => {
    expect(
      decideReleaseDue({
        settings: { ...mondayBerlin, days: [0], time: "02:30" },
        now: new Date("2026-03-29T01:00:00Z"),
        lastReleasedAt: null,
      }),
    ).toBe(true);
  });
});
