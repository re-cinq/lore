import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import {
  captureBaselineForRepo,
  captureBaselineAllRepos,
  type BaselineRepoScan,
} from "./dark-factory-baseline.js";
import {
  InMemoryBaseline,
  type TaskRecord,
} from "@re-cinq/lore-shared/project/baseline/baseline-memory.js";
import type { BaselinePort } from "@re-cinq/lore-shared/project/baseline/baseline-port.js";

const NOW = new Date("2026-06-30T00:00:00Z");
const created = new Date("2026-06-15T00:00:00Z");
const hoursLater = (h: number) => new Date(created.getTime() + h * 3600_000);

const task = (over: Partial<TaskRecord>): TaskRecord => ({
  target_repo: "re-cinq/lore",
  created_at: created,
  updated_at: hoursLater(2),
  ...over,
});

const repoScan = (repos: string[]): BaselineRepoScan => ({
  distinctTargetRepos: async () => repos,
});

describe("captureBaselineForRepo", () => {
  it("derives issues_per_week and median time-to-merge from window tasks", async () => {
    const baseline = new InMemoryBaseline([
      task({ pr_url: "pr1", updated_at: hoursLater(2) }),
      task({ pr_url: "pr2", updated_at: hoursLater(4) }),
    ]);

    await captureBaselineForRepo(
      "re-cinq/lore",
      30,
      { baseline, repoScan: repoScan(["re-cinq/lore"]) },
      NOW,
    );

    expect(baseline.rows).toHaveLength(1);
    expect(baseline.rows[0].counters).toMatchObject({
      issues_per_week: (2 * 7) / 30,
      median_time_to_merge_hours: 3,
      job_pods_per_impl_task_p50: 4,
      _job_pods_source: "static_baseline",
    });
  });

  it("falls back to zero counters for a repo with no tasks in the window", async () => {
    const baseline = new InMemoryBaseline([]);

    await captureBaselineForRepo(
      "re-cinq/empty",
      30,
      { baseline, repoScan: repoScan([]) },
      NOW,
    );

    expect(baseline.rows[0].counters).toMatchObject({
      issues_per_week: 0,
      median_time_to_merge_hours: 0,
    });
  });
});

describe("captureBaselineAllRepos", () => {
  it("snapshots every distinct repo and tolerates a per-repo failure", async () => {
    const rows: InstanceType<typeof InMemoryBaseline>["rows"] = [];
    const failing: BaselinePort = {
      insert: async (row) => {
        rows.push(row);
      },
      baselineStats: async (repo) => {
        enforceTrue(repo !== "re-cinq/bad", Error, "boom");

        return { issues_count: 1, median_ttm_hours: 5 };
      },
    };

    const result = await captureBaselineAllRepos(
      {
        baseline: failing,
        repoScan: repoScan(["re-cinq/good", "re-cinq/bad"]),
      },
      NOW,
    );

    expect(result).toBe("Captured baselines for 1/2 repos");
    expect(rows.map((r) => r.repo)).toEqual(["re-cinq/good"]);
  });
});
