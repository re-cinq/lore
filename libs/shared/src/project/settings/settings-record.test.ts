import { describe, it, expect } from "vitest";
import { InMemorySettings } from "./settings-memory.js";
import { PgSettings } from "./settings-pg.js";
import type { PgPool } from "../../memory-store.js";

/**
 * `record()` is the whole `lore.repos` row, added because five web-ui pages each
 * SELECTed a different column subset of it. One read serves them all; a caller
 * picks the fields it needs.
 */

function fakePool(
  capture: Array<{ text: string; params?: unknown[] }>,
  rows: unknown[],
): PgPool {
  return {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: rows as T[] };
    },
  };
}

const SEEDED = {
  full_name: "re-cinq/lore",
  team: "platform",
  settings: { trust: { level: "tests" } },
  onboarding_pr_merged: true,
};

describe("InMemorySettings.record", () => {
  it("returns the seeded row for an onboarded repo", async () => {
    const settings = new InMemorySettings([SEEDED]);

    expect(await settings.record("re-cinq/lore")).toMatchObject({
      full_name: "re-cinq/lore",
      team: "platform",
      settings: { trust: { level: "tests" } },
    });
  });

  it("returns null for a repo with no row", async () => {
    const settings = new InMemorySettings([SEEDED]);

    expect(await settings.record("other/repo")).toBeNull();
  });
});

describe("PgSettings.record", () => {
  it("selects the repo row by full name", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const settings = new PgSettings(fakePool(capture, [SEEDED]));

    const row = await settings.record("re-cinq/lore");

    expect(row).toMatchObject({ full_name: "re-cinq/lore", team: "platform" });
    expect(capture[0]).toMatchObject({ params: ["re-cinq/lore"] });
    expect(capture[0].text).toContain("FROM lore.repos");
  });

  it("returns null when the repo has no row", async () => {
    const settings = new PgSettings(fakePool([], []));

    expect(await settings.record("gone/repo")).toBeNull();
  });
});
