import { describe, it, expect } from "vitest";
import { InMemorySettings } from "./settings-memory.js";
import { PgSettings } from "./settings-pg.js";
import type { PgPool } from "../../memory-store.js";

/**
 * `record()` is the whole `lore.repos` row, added because five web-ui pages each
 * SELECTed a different column subset of it. One read serves them all; a caller
 * picks the fields it needs.
 *
 * The row is the `Repo` model (`libs/shared/src/models/repo.ts`), so both
 * adapters answer in the model's camelCase regardless of how the columns are
 * spelled in Postgres — that mapping is what these tests pin.
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

/** A row as the driver hands it back — every column, snake_case. */
const DB_ROW = {
  id: "5f0ffc55-0000-4000-8000-000000000001",
  owner: "re-cinq",
  name: "lore",
  full_name: "re-cinq/lore",
  team: "platform",
  onboarded_at: new Date("2026-08-01T00:00:00Z"),
  last_ingested_at: null,
  onboarding_pr_url: null,
  onboarding_pr_merged: true,
  settings: { trust: { level: "tests" } },
  outcome_stats: null,
};

describe("InMemorySettings.record", () => {
  it("returns the seeded row as the camelCase model", async () => {
    const settings = new InMemorySettings([SEEDED]);

    expect(await settings.record("re-cinq/lore")).toMatchObject({
      fullName: "re-cinq/lore",
      team: "platform",
      settings: { trust: { level: "tests" } },
      onboardingPrMerged: true,
    });
  });

  it("returns null for a repo with no row", async () => {
    const settings = new InMemorySettings([SEEDED]);

    expect(await settings.record("other/repo")).toBeNull();
  });
});

describe("PgSettings.record", () => {
  it("maps every column of the row onto the model's fields", async () => {
    const settings = new PgSettings(fakePool([], [DB_ROW]));

    expect(await settings.record("re-cinq/lore")).toEqual({
      id: "5f0ffc55-0000-4000-8000-000000000001",
      owner: "re-cinq",
      name: "lore",
      fullName: "re-cinq/lore",
      team: "platform",
      onboardedAt: new Date("2026-08-01T00:00:00Z"),
      lastIngestedAt: null,
      onboardingPrUrl: null,
      onboardingPrMerged: true,
      settings: { trust: { level: "tests" } },
      outcomeStats: null,
    });
  });

  it("selects the model's columns from lore.repos by full name", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const settings = new PgSettings(fakePool(capture, [DB_ROW]));

    await settings.record("re-cinq/lore");

    expect(capture[0]).toMatchObject({ params: ["re-cinq/lore"] });
    expect(capture[0].text).toContain("FROM lore.repos");
    expect(capture[0].text).toContain("full_name");
    expect(capture[0].text).toContain("onboarding_pr_merged");
  });

  it("returns null when the repo has no row", async () => {
    const settings = new PgSettings(fakePool([], []));

    expect(await settings.record("gone/repo")).toBeNull();
  });
});
