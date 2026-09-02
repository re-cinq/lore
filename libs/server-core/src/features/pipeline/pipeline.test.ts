import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { setPipelinePool, handleReviewResult } from "./pipeline.js";

// handleReviewResult runs its queries against the module-level pool set via
// setPipelinePool. A scripted mock pool returns rows by matching the SQL text,
// so each test asserts on the exact statements the handler issues — no live
// Postgres needed. Script order matters: the first matching entry wins.

interface ScriptedRow {
  match: RegExp;
  rows: Record<string, unknown>[];
}

function scriptedPool(scripts: ScriptedRow[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = scripts.find((s) => s.match.test(sql));

      return { rows: hit ? hit.rows : [] };
    }),
    calls,
  };

  return pool;
}

function bindPool(scripts: ScriptedRow[]) {
  const pool = scriptedPool(scripts);

  setPipelinePool(pool as unknown as Pool);

  return pool;
}

const taskRow = (reviewIteration: number): Record<string, unknown> => ({
  id: "t1",
  task_type: "general",
  status: "review",
  target_repo: "o/r",
  target_branch: "feat/x",
  created_by: "ui",
  review_iteration: reviewIteration,
});

const baseScripts = (reviewIteration: number): ScriptedRow[] => [
  { match: /SELECT status FROM pipeline\.tasks/, rows: [{ status: "review" }] },
  { match: /FROM pipeline\.task_events/, rows: [] },
  {
    match: /FROM pipeline\.tasks WHERE id/,
    rows: [taskRow(reviewIteration)],
  },
];

describe("handleReviewResult", () => {
  it("returns without writing anything when the task does not exist", async () => {
    const pool = bindPool([
      { match: /FROM pipeline\.tasks WHERE id/, rows: [] },
    ]);

    await handleReviewResult("missing", true, "lgtm");

    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].sql).toMatch(/FROM pipeline\.tasks WHERE id/);
  });

  it("marks the task review with review_result approved when the review approves", async () => {
    const pool = bindPool(baseScripts(0));

    await handleReviewResult("t1", true, "lgtm");

    const statusUpdate = pool.calls.find((c) =>
      /UPDATE pipeline\.tasks SET status/.test(c.sql),
    );
    const event = pool.calls.find((c) =>
      /INSERT INTO pipeline\.task_events/.test(c.sql),
    );

    expect(statusUpdate?.params).toEqual(["review", "t1"]);
    expect(event?.params).toEqual([
      "t1",
      "review",
      "review",
      JSON.stringify({ review_result: "approved", comments: "lgtm" }),
    ]);
  });

  it("bumps review_iteration to 2 and escalates to needs-human-review on the second rejection", async () => {
    const pool = bindPool(baseScripts(1));

    await handleReviewResult("t1", false, "still broken");

    const iterationUpdate = pool.calls.find((c) =>
      /SET review_iteration/.test(c.sql),
    );
    const event = pool.calls.find((c) =>
      /INSERT INTO pipeline\.task_events/.test(c.sql),
    );

    expect(iterationUpdate?.params).toEqual([2, "t1"]);
    expect(event?.params).toEqual([
      "t1",
      "review",
      "review",
      JSON.stringify({
        review_result: "needs-human-review",
        comments: "still broken",
        iterations: 2,
      }),
    ]);
    expect(
      pool.calls.some((c) => /INSERT INTO pipeline\.tasks/.test(c.sql)),
    ).toBe(false);
  });

  it("creates an immediate follow-up task on the same branch on the first rejection", async () => {
    const pool = bindPool([
      ...baseScripts(0),
      { match: /SELECT settings FROM lore\.repos/, rows: [] },
      {
        match: /INSERT INTO pipeline\.tasks/,
        rows: [
          {
            id: "t2",
            status: "pending",
            priority: "immediate",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
    ]);

    await handleReviewResult("t1", false, "needs a guard clause");

    const iterationUpdate = pool.calls.find((c) =>
      /SET review_iteration/.test(c.sql),
    );
    const insert = pool.calls.find((c) =>
      /INSERT INTO pipeline\.tasks/.test(c.sql),
    );

    expect(iterationUpdate?.params).toEqual([1, "t1"]);
    expect(insert?.params).toEqual([
      "Address review feedback on PR: needs a guard clause",
      "general",
      "o/r",
      "review-agent",
      JSON.stringify({
        branch: "feat/x",
        review_comments: "needs a guard clause",
      }),
      "immediate",
    ]);
  });
});
