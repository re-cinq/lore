import { describe, it, expect } from "vitest";
import { PgTaskStore } from "./task-store-pg.js";
import type { PgPool } from "../../memory-store.js";

/**
 * PgTaskStore against a fake PgPool that records the SQL + params (the
 * memory-store fake-pool style). Proves the status grouping and repo binding
 * reach the right query without a live database.
 */

function fakePool(capture: Array<{ text: string; params?: unknown[] }>, rows: unknown[] = []): PgPool {
  return {
    query: async (text: string, params?: unknown[]) => {
      capture.push({ text, params });
      return { rows };
    },
  };
}

describe("PgTaskStore", () => {
  it("queries pending statuses bound to the repo", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgTaskStore(fakePool(capture));

    await store.pending("re-cinq/lore");

    expect(capture[0].text).toContain("WHERE target_repo = $1 AND status = ANY($2)");
    expect(capture[0].params).toEqual(["re-cinq/lore", ["pending", "queued", "awaiting_approval"]]);
  });

  it("transitions a cancel to the cancelled status", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgTaskStore(fakePool(capture, [{ id: "a", status: "cancelled" }]));

    const updated = await store.transition("a", "cancel");

    expect(capture[0].text).toContain("UPDATE pipeline.tasks");
    expect(capture[0].params).toEqual(["a", "cancelled", null]);
    expect(updated).toMatchObject({ id: "a", status: "cancelled" });
  });
});
