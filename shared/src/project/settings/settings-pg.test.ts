import { describe, it, expect } from "vitest";
import { PgSettings } from "./settings-pg.js";
import { resolveDarkFactorySettings } from "../../dark-factory-settings.js";
import type { PgPool } from "../../memory-store.js";

/**
 * PgSettings.resolve reads the JSONB row via a fake PgPool and resolves through
 * the real resolveDarkFactorySettings — proving the SQL + repo binding without a
 * live database.
 */

function fakePool(capture: Array<{ text: string; params?: unknown[] }>, rows: unknown[]): PgPool {
  return {
    query: async (text: string, params?: unknown[]) => {
      capture.push({ text, params });
      return { rows };
    },
  };
}

describe("PgSettings", () => {
  it("resolves the repo's dark_factory settings from the JSONB row", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSettings(fakePool(capture, [{ settings: { dark_factory: { enabled: true } } }]));

    const resolved = await store.resolve("re-cinq/lore");

    expect(capture[0].params).toEqual(["re-cinq/lore"]);
    expect(resolved).toEqual(resolveDarkFactorySettings({ enabled: true }));
  });

  it("falls back to defaults when the repo has no settings row", async () => {
    const store = new PgSettings(fakePool([], []));

    expect(await store.resolve("missing/repo")).toEqual(resolveDarkFactorySettings(undefined));
  });
});
