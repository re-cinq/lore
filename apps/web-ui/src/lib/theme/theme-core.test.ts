import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAMILY,
  DEFAULT_SCHEME,
  parseFamily,
  parseSchemePref,
  resolveColorScheme,
} from "./theme-core";
import { ICONS } from "@/components/icon-map";

describe("resolveColorScheme", () => {
  it("returns light when pref light regardless of system", () => {
    expect(resolveColorScheme("light", true)).toBe("light");
    expect(resolveColorScheme("light", false)).toBe("light");
  });

  it("returns dark when pref dark regardless of system", () => {
    expect(resolveColorScheme("dark", false)).toBe("dark");
    expect(resolveColorScheme("dark", true)).toBe("dark");
  });

  it("follows system when pref auto", () => {
    expect(resolveColorScheme("auto", true)).toBe("dark");
    expect(resolveColorScheme("auto", false)).toBe("light");
  });
});

describe("parseFamily", () => {
  it("passes through valid families", () => {
    expect(parseFamily("elegant")).toBe("elegant");
    expect(parseFamily("retro")).toBe("retro");
    expect(parseFamily("chicago")).toBe("chicago");
  });

  it("falls back to default on garbage or null", () => {
    expect(parseFamily("neon")).toBe(DEFAULT_FAMILY);
    expect(parseFamily(null)).toBe(DEFAULT_FAMILY);
  });
});

describe("parseSchemePref", () => {
  it("passes through valid prefs", () => {
    expect(parseSchemePref("light")).toBe("light");
    expect(parseSchemePref("dark")).toBe("dark");
    expect(parseSchemePref("auto")).toBe("auto");
  });

  it("falls back to default on garbage or null", () => {
    expect(parseSchemePref("sepia")).toBe(DEFAULT_SCHEME);
    expect(parseSchemePref(null)).toBe(DEFAULT_SCHEME);
  });
});

describe("ICONS", () => {
  it("defines the same icon names across all families", () => {
    const names = Object.keys(ICONS.elegant).sort();

    expect(Object.keys(ICONS.retro).sort()).toEqual(names);
    expect(Object.keys(ICONS.chicago).sort()).toEqual(names);
  });
});
