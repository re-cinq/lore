import { describe, it, expect } from "vitest";
import { PgTaskStore } from "./task-store-pg.js";
import { OPEN_TASK_STATES } from "./task-store-port.js";
import type { PgPool } from "../../memory-store.js";

/**
 * PgTaskStore against a fake PgPool that records the SQL + params (the
 * memory-store fake-pool style). Proves the status grouping and repo binding
 * reach the right query without a live database.
 */

function fakePool(
  capture: Array<{ text: string; params?: unknown[] }>,
  rows: unknown[] = [],
): PgPool {
  return {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: rows as T[] as T[] };
    },
  };
}

describe("PgTaskStore", () => {
  it("queries pending statuses bound to the repo", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgTaskStore(fakePool(capture));

    await store.pending("re-cinq/lore");

    expect(capture[0].text).toContain(
      "WHERE target_repo = $1 AND status = ANY($2)",
    );
    expect(capture[0].params).toEqual([
      "re-cinq/lore",
      ["pending", "queued", "awaiting_approval"],
    ]);
  });

  it("transitions a cancel to the cancelled status", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgTaskStore(
      fakePool(capture, [{ id: "a", status: "cancelled" }]),
    );

    const updated = await store.transition("a", "cancel");

    expect(capture[0].text).toContain("UPDATE pipeline.tasks");
    expect(capture[0].params).toEqual(["a", "cancelled", null]);
    expect(updated).toMatchObject({ id: "a", status: "cancelled" });
  });

  it("setStatus writes status + updated_at + only allowlisted extra columns", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgTaskStore(fakePool(capture));

    await store.setStatus("a", "running-local", {
      agent_id: "agent-1",
      evil_column: "drop",
      pr_url: "u",
    });

    expect(capture[0].text).toContain("status = $1, updated_at = now()");
    expect(capture[0].text).toContain("agent_id = $2");
    expect(capture[0].text).toContain("pr_url = $3");
    expect(capture[0].text).not.toContain("evil_column");
    expect(capture[0].params).toEqual(["running-local", "agent-1", "u", "a"]);
  });

  it("updateStatus reads the old status, sets the new one, then records the event", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgTaskStore(fakePool(capture, [{ status: "pending" }]));

    await store.updateStatus("a", "queued", { agent_id: "x" });

    expect(capture[0].text).toContain("SELECT status FROM pipeline.tasks");
    expect(capture[1].text).toContain(
      "UPDATE pipeline.tasks SET status = $1, updated_at = now()",
    );
    expect(capture[2].text).toContain("INSERT INTO pipeline.task_events");
    expect(capture[2].params?.slice(1, 3)).toEqual(["pending", "queued"]);
  });

  it("findOpenLike filters by repo, type, description prefix, and the given statuses", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgTaskStore(fakePool(capture, [{ id: "g1" }]));

    const statuses = [...OPEN_TASK_STATES, "failed"];
    const found = await store.findOpenLike({
      repo: "re-cinq/lore",
      taskType: "gap-fill",
      descriptionPrefix: "Gap: missing-adrs",
      statuses,
    });

    expect(capture[0].text).toContain(
      "description LIKE $3 AND status = ANY($4)",
    );
    expect(capture[0].params).toEqual([
      "re-cinq/lore",
      "gap-fill",
      "Gap: missing-adrs%",
      statuses,
    ]);
    expect(found).toEqual([{ id: "g1" }]);
  });
});
