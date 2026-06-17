import { describe, it, expect } from "vitest";
import { PgFeatures } from "./features-pg.js";
import type { PgPool } from "../../memory-store.js";

/** Fake pool that records queries and returns queued result sets in order. */
function fakePool(queued: any[][]): { pool: PgPool; calls: { text: string; params?: unknown[] }[] } {
  const calls: { text: string; params?: unknown[] }[] = [];
  let i = 0;
  const pool: PgPool = {
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return { rows: queued[i++] ?? [] };
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
  it("bumps the feature counter then inserts a running iteration", async () => {
    const { pool, calls } = fakePool([
      [{ current_iteration: 2 }], // UPDATE ... RETURNING current_iteration
      [{ id: "it1", iteration: 2 }], // INSERT iteration
    ]);
    await new PgFeatures(pool).appendIteration("octo/repo", "f1", "task1", { free_form: "x" });
    expect(calls[0].text).toContain("UPDATE lore.features");
    expect(calls[0].text).toContain("current_iteration = current_iteration + 1");
    expect(calls[0].text).toContain("status = 'planning'");
    expect(calls[1].text).toContain("INSERT INTO lore.feature_iterations");
    expect(calls[1].params).toEqual(["f1", 2, "task1", JSON.stringify({ free_form: "x" })]);
  });
});

describe("PgFeatures.setIterationResult", () => {
  it("updates the iteration row's gap_result and status", async () => {
    const { pool, calls } = fakePool([[]]);
    const gap = {
      architecture: { summary: "", components: [] },
      user_flows: [],
      mockups: [],
      questions: [],
      draft_spec_markdown: "# x",
    };
    await new PgFeatures(pool).setIterationResult("octo/repo", "f1", 1, gap, "ready");
    expect(calls[0].text).toContain("UPDATE lore.feature_iterations");
    expect(calls[0].params).toEqual([JSON.stringify(gap), "ready", "f1", 1]);
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
    expect(calls[0].params).toEqual(["pr-open", "https://pr", 7, "f1", "octo/repo"]);
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
