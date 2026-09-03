import { describe, it, expect } from "vitest";
import { PgFeatures } from "./features-pg.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(queued: Record<string, unknown>[][]): {
  pool: PgPool;
  calls: { text: string; params?: unknown[] }[];
} {
  const calls: { text: string; params?: unknown[] }[] = [];
  let i = 0;
  const pool: PgPool = {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      calls.push({ text, params });

      return { rows: (queued[i++] ?? []) as T[] };
    },
  };

  return { pool, calls };
}

describe("PgFeatures.create", () => {
  it("inserts into lore.features with repo, derived slug/path, and draft status", async () => {
    const { pool, calls } = fakePool([[{ id: "f1" }]]);

    await new PgFeatures(pool).create("octo/repo", {
      title: "Smart Planning",
      prompt: "do the thing",
    });
    expect(calls[0].text).toContain("INSERT INTO lore.features");
    expect(calls[0].params).toEqual([
      "octo/repo",
      "Smart Planning",
      "smart-planning",
      "specs/smart-planning",
      "do the thing",
      null,
      "ui",
    ]);
  });
});

describe("PgFeatures.list", () => {
  it("selects by repo ordered by updated_at without a status filter", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgFeatures(pool).list("octo/repo");
    expect(calls[0].text).toContain("FROM lore.features");
    expect(calls[0].text).toContain("ORDER BY updated_at DESC");
    expect(calls[0].text).not.toContain("status =");
    expect(calls[0].params).toEqual(["octo/repo"]);
  });

  it("adds a status filter when given", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgFeatures(pool).list("octo/repo", "pr-open");
    expect(calls[0].text).toContain("status = $2");
    expect(calls[0].params).toEqual(["octo/repo", "pr-open"]);
  });
});

describe("PgFeatures.appendIteration", () => {
  it("bumps the feature counter then inserts a running iteration with no taskId (attached later) and no parent (only a rewind records one)", async () => {
    const { pool, calls } = fakePool([
      [{ current_iteration: 2 }],
      [{ id: "it1", iteration: 2 }],
    ]);
    const row = await new PgFeatures(pool).appendIteration("octo/repo", "f1", {
      free_form: "x",
    });

    expect(calls[0].text).toContain("UPDATE lore.features");
    expect(calls[0].text).toContain(
      "current_iteration = current_iteration + 1",
    );
    expect(calls[0].text).toContain("status = 'planning'");
    expect(calls[1].text).toContain("INSERT INTO lore.feature_iterations");
    expect(calls[1].params).toEqual([
      "f1",
      2,
      JSON.stringify({ free_form: "x" }),
      null,
    ]);
    expect(row).toEqual({ id: "it1", iteration: 2 });
  });
});

describe("PgFeatures.attachIterationTask", () => {
  it("sets task_id on the iteration, scoped to the owning repo", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgFeatures(pool).attachIterationTask(
      "octo/repo",
      "f1",
      2,
      "task1",
    );
    expect(calls[0].text).toContain("UPDATE lore.feature_iterations");
    expect(calls[0].text).toContain("task_id = $1");
    expect(calls[0].text).toContain("repo = $4");
    expect(calls[0].params).toEqual(["task1", "f1", 2, "octo/repo"]);
  });
});

describe("PgFeatures.setIterationResult", () => {
  it("updates the iteration row's gap_result and status, scoped to the owning repo", async () => {
    const { pool, calls } = fakePool([[]]);
    const gap = {
      sections: [{ title: "Overview", content: "x" }],
      draft_spec_markdown: "# x",
    };

    await new PgFeatures(pool).setIterationResult(
      "octo/repo",
      "f1",
      1,
      gap,
      "ready",
    );
    expect(calls[0].text).toContain("UPDATE lore.feature_iterations");
    expect(calls[0].text).toContain("repo = $5");
    expect(calls[0].params).toEqual([
      JSON.stringify(gap),
      "ready",
      "f1",
      1,
      "octo/repo",
    ]);
  });
});

describe("PgFeatures.transitionStatus", () => {
  it("sets status only when no patch is given", async () => {
    const { pool, calls } = fakePool([[{ id: "f1", status: "pr-open" }]]);

    await new PgFeatures(pool).transitionStatus("octo/repo", "f1", "pr-open");
    expect(calls[0].text).toContain("UPDATE lore.features");
    expect(calls[0].text).toContain("status = $1");
    expect(calls[0].params).toEqual(["pr-open", "f1", "octo/repo"]);
  });

  it("patches provided columns alongside status", async () => {
    const { pool, calls } = fakePool([[{ id: "f1" }]]);

    await new PgFeatures(pool).transitionStatus("octo/repo", "f1", "pr-open", {
      spec_pr_url: "https://pr",
      spec_pr_number: 7,
    });
    expect(calls[0].text).toContain("spec_pr_url =");
    expect(calls[0].text).toContain("spec_pr_number =");
    expect(calls[0].params).toEqual([
      "pr-open",
      "https://pr",
      7,
      "f1",
      "octo/repo",
    ]);
  });
});

describe("PgFeatures.delete", () => {
  it("deletes the feature scoped to its repo and returns true when a row is removed", async () => {
    const { pool, calls } = fakePool([[{ id: "f1" }]]);
    const deleted = await new PgFeatures(pool).delete("octo/repo", "f1");

    expect(calls[0].text).toContain("DELETE FROM lore.features");
    expect(calls[0].text).toContain("WHERE id = $1 AND repo = $2");
    expect(calls[0].params).toEqual(["f1", "octo/repo"]);
    expect(deleted).toBe(true);
  });

  it("returns false when no matching feature exists", async () => {
    const { pool } = fakePool([[]]);

    expect(await new PgFeatures(pool).delete("octo/repo", "missing")).toBe(
      false,
    );
  });
});

describe("PgFeatures.createSplitChild", () => {
  it("inserts a child with parent_feature_id set", async () => {
    const { pool, calls } = fakePool([[{ id: "child" }]]);

    await new PgFeatures(pool).createSplitChild("octo/repo", "parent1", {
      title: "Part A",
      prompt: "carve out A",
    });
    expect(calls[0].text).toContain("INSERT INTO lore.features");
    expect(calls[0].params).toEqual([
      "octo/repo",
      "Part A",
      "part-a",
      "specs/part-a",
      "carve out A",
      "parent1",
      "ui",
    ]);
  });
});
