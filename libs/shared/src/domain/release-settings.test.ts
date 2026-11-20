import { describe, it, expect } from "vitest";
import { releaseEnabled, resolveReleaseSettings } from "./release-settings.js";

describe("resolveReleaseSettings", () => {
  it("returns disabled, Monday 09:00 Europe/Berlin when the block is absent", () => {
    expect(resolveReleaseSettings(undefined)).toEqual({
      enabled: false,
      days: [1],
      time: "09:00",
      timezone: "Europe/Berlin",
    });
  });

  it("keeps the given time and days and fills the timezone", () => {
    expect(
      resolveReleaseSettings({ enabled: true, time: "17:30", days: [5] }),
    ).toEqual({
      enabled: true,
      days: [5],
      time: "17:30",
      timezone: "Europe/Berlin",
    });
  });

  it("ignores a key set to undefined", () => {
    expect(resolveReleaseSettings({ time: undefined }).time).toBe("09:00");
  });
});

describe("releaseEnabled", () => {
  it("returns false for settings with no release block", () => {
    expect(releaseEnabled({ auto_review: true })).toBe(false);
  });

  it("returns false for a release block without enabled", () => {
    expect(releaseEnabled({ release: { days: [1] } })).toBe(false);
  });

  it("returns true for a release block with enabled true", () => {
    expect(releaseEnabled({ release: { enabled: true } })).toBe(true);
  });

  it("returns false for null settings", () => {
    expect(releaseEnabled(null)).toBe(false);
  });

  it("returns false for a release block cleared to null", () => {
    expect(releaseEnabled({ release: null })).toBe(false);
  });

  it("resolves a release block cleared to null to disabled, Monday 09:00 Europe/Berlin", () => {
    expect(resolveReleaseSettings(null)).toEqual({
      enabled: false,
      days: [1],
      time: "09:00",
      timezone: "Europe/Berlin",
    });
  });
});
