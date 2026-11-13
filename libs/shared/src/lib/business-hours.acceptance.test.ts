import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isBusinessHours } from "./business-hours.js";

const ENV_KEYS = ["LORE_BUSINESS_HOURS_TZ"] as const;

const WED_08_30Z = new Date("2026-06-03T08:30:00Z");

describe("isBusinessHours (acceptance)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = saved[key];
    }
  });

  it("falls back to the default timezone instead of throwing on an invalid timezone", () => {
    process.env.LORE_BUSINESS_HOURS_TZ = "Invalid/Zone";
    expect(isBusinessHours(WED_08_30Z)).toBe(true);
  });
});
