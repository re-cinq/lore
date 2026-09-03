import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isBusinessHours } from "./business-hours.js";

const ENV_KEYS = [
  "LORE_BUSINESS_HOURS_TZ",
  "LORE_BUSINESS_HOURS_START",
  "LORE_BUSINESS_HOURS_END",
  "LORE_BUSINESS_DAYS",
] as const;

const WED_10_00Z = new Date("2026-06-03T10:00:00Z");
const WED_08_30Z = new Date("2026-06-03T08:30:00Z");
const WED_09_00Z = new Date("2026-06-03T09:00:00Z");
const WED_18_00Z = new Date("2026-06-03T18:00:00Z");
const SAT_10_00Z = new Date("2026-06-06T10:00:00Z");

describe("isBusinessHours", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
    process.env.LORE_BUSINESS_HOURS_TZ = "UTC";
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

  it("returns true inside the window on a weekday", () => {
    expect(isBusinessHours(WED_10_00Z)).toBe(true);
  });

  it("returns false on a weekend even inside the hour window", () => {
    expect(isBusinessHours(SAT_10_00Z)).toBe(false);
  });

  it("includes the start hour and excludes the end hour", () => {
    expect(isBusinessHours(WED_09_00Z)).toBe(true);
    expect(isBusinessHours(WED_18_00Z)).toBe(false);
  });

  it("resolves the wall-clock hour in the configured timezone", () => {
    process.env.LORE_BUSINESS_HOURS_TZ = "UTC";
    expect(isBusinessHours(WED_08_30Z)).toBe(false);
    process.env.LORE_BUSINESS_HOURS_TZ = "Europe/Berlin";
    expect(isBusinessHours(WED_08_30Z)).toBe(true);
  });

  it("honors a custom hour window", () => {
    process.env.LORE_BUSINESS_HOURS_START = "10";
    process.env.LORE_BUSINESS_HOURS_END = "12";
    expect(isBusinessHours(WED_09_00Z)).toBe(false);
    expect(isBusinessHours(WED_10_00Z)).toBe(true);
  });

  it("honors a custom day set", () => {
    process.env.LORE_BUSINESS_DAYS = "6,7";
    expect(isBusinessHours(SAT_10_00Z)).toBe(true);
    expect(isBusinessHours(WED_10_00Z)).toBe(false);
  });

  it("falls back to defaults when env values are invalid", () => {
    process.env.LORE_BUSINESS_HOURS_START = "99";
    process.env.LORE_BUSINESS_HOURS_END = "nope";
    process.env.LORE_BUSINESS_DAYS = "12";
    expect(isBusinessHours(WED_10_00Z)).toBe(true);
    expect(isBusinessHours(WED_18_00Z)).toBe(false);
  });
});
