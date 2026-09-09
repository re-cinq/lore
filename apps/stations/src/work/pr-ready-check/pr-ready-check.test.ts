import { describe, expect, it } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ParkedTarget } from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import { prReadyCheckSweep, type PrReadyCheckDeps } from "./pr-ready-check.js";

import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

const graph: RunGraph = {
  name: "implementation-loop",
  entry: "implement",
  exit: "done",
  nodes: [
    {
      id: "implement",
      type: "agent",
      station: "agent",
      station_inherited: true,
    },
    {
      id: "await-ci",
      type: "ci_check",
      station: "ci-check",
      station_inherited: true,
    },
    {
      id: "await-pr",
      type: "pr_review",
      station: "pr-review",
      station_inherited: true,
    },
  ],
  edges: [],
};

const redCheck = {
  name: "lint",
  status: "completed",
  conclusion: "failure",
  output: { title: "3 problems", summary: "no-unused-vars" },
};

const pendingCheck = {
  name: "test",
  status: "in_progress",
  conclusion: null,
};

const parkedAtCi = [
  { nodeId: "implement", iteration: 1, outcome: "success" },
  { nodeId: "await-ci", iteration: 1, outcome: null },
];

function deps(overrides: Partial<PrReadyCheckDeps> = {}) {
  const reported: Array<{
    target: ParkedTarget;
    outcome: string;
    args?: Record<string, unknown>;
  }> = [];
  const base: PrReadyCheckDeps = {
    listOpenLoopRuns: async () => [
      {
        id: "run-1",
        repo: "acme/widgets",
        status: "running",
        args: { pr_number: 12 },
        graph,
      },
    ],
    listStationRuns: async () => [
      { nodeId: "implement", iteration: 1, outcome: "success" },
      { nodeId: "await-pr", iteration: 1, outcome: null },
    ],
    listPrCommits: async () => [
      {
        sha: "deadbeef",
        message: "feat: a round",
        date: "2026-09-09T10:00:00Z",
      },
    ],
    hasCiHistory: async () => true,
    listChecks: async () => [
      { name: "test", status: "completed", conclusion: "success" },
    ],
    listReviewThreads: async () => [],
    countOpenReviewRuns: async () => 0,
    report: async (target, outcome, args) => {
      reported.push({ target, outcome, ...(args ? { args } : {}) });
    },
  };

  return { deps: { ...base, ...overrides }, reported };
}

describe("prReadyCheckSweep", () => {
  it("resumes a green thread-clean parked run with success", async () => {
    const d = deps();

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([
      {
        target: { lineId: "run-1", nodeId: "await-pr", iteration: 1 },
        outcome: "success",
        args: {},
      },
    ]);
    expect(summary).toBe("checked 1, resumed 1, blocked 0, waiting 0");
  });

  it("resumes with changes_requested when CI is red", async () => {
    const d = deps({ listChecks: async () => [redCheck] });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([
      {
        target: { lineId: "run-1", nodeId: "await-pr", iteration: 1 },
        outcome: "changes_requested",
        args: {
          reason: "ci_red",
          ci_feedback_sha: "deadbeef",
          ci_failed_checks: "lint",
          ci_failure_summary:
            "### lint (failure)\n\n3 problems\n\nno-unused-vars",
        },
      },
    ]);
  });

  it("reports nothing while CI is pending", async () => {
    const d = deps({ listChecks: async () => [pendingCheck] });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
    expect(summary).toBe("checked 1, resumed 0, blocked 0, waiting 1");
  });

  it("reports nothing when a CI-running repo has no checks yet for the head sha", async () => {
    const d = deps({
      listChecks: async () => [],
      hasCiHistory: async () => true,
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
    expect(summary).toBe("checked 1, resumed 0, blocked 0, waiting 1");
  });

  it("resumes a repo that runs no checks at all, so it cannot wedge its loop", async () => {
    const d = deps({
      listChecks: async () => [],
      hasCiHistory: async () => false,
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(summary).toBe("checked 1, resumed 1, blocked 0, waiting 0");
  });

  it("waits on unresolved threads while a review-family run is open", async () => {
    const d = deps({
      listReviewThreads: async () => [
        { id: "PRRT_1", isResolved: false, isOutdated: false, comments: [] },
      ],
      countOpenReviewRuns: async () => 1,
    });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
  });

  it("skips a run that is not parked at a pr_review node", async () => {
    const d = deps({
      listStationRuns: async () => [
        { nodeId: "implement", iteration: 1, outcome: null },
      ],
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
    expect(summary).toBe("checked 1, resumed 0, blocked 0, waiting 0");
  });

  it("skips a parked run whose args carry no pr_number", async () => {
    const d = deps({
      listOpenLoopRuns: async () => [
        {
          id: "run-1",
          repo: "acme/widgets",
          status: "running",
          args: {},
          graph,
        },
      ],
    });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
  });

  it("keeps sweeping when one run's PR read throws", async () => {
    const d = deps({
      listOpenLoopRuns: async () => [
        {
          id: "run-err",
          repo: "acme/widgets",
          status: "running",
          args: { pr_number: 1 },
          graph,
        },
        {
          id: "run-ok",
          repo: "acme/widgets",
          status: "running",
          args: { pr_number: 2 },
          graph,
        },
      ],
      listPrCommits: async (_repo, number) => {
        enforceTrue(number !== 1, Error, "boom");

        return [
          {
            sha: "cafebabe",
            message: "feat: ok",
            date: "2026-09-09T10:00:00Z",
          },
        ];
      },
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([
      {
        target: { lineId: "run-ok", nodeId: "await-pr", iteration: 1 },
        outcome: "success",
        args: {},
      },
    ]);
    expect(summary).toBe(
      "checked 2, resumed 1, blocked 0, waiting 0, errors 1",
    );
  });

  it("counts a parked run with no judgeable commit as waiting, not as an error", async () => {
    const d = deps({ listPrCommits: async () => [] });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
    expect(summary).toBe("checked 1, resumed 0, blocked 0, waiting 1");
  });

  it("resumes an await-ci park with success when the judged sha is green", async () => {
    const d = deps({ listStationRuns: async () => parkedAtCi });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([
      {
        target: { lineId: "run-1", nodeId: "await-ci", iteration: 1 },
        outcome: "success",
        args: {},
      },
    ]);
  });

  it("sends a red round back with the failed check names and the sha they were read from", async () => {
    const d = deps({
      listStationRuns: async () => parkedAtCi,
      listChecks: async () => [redCheck],
    });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([
      {
        target: { lineId: "run-1", nodeId: "await-ci", iteration: 1 },
        outcome: "changes_requested",
        args: {
          reason: "ci_red",
          ci_feedback_sha: "deadbeef",
          ci_failed_checks: "lint",
          ci_failure_summary:
            "### lint (failure)\n\n3 problems\n\nno-unused-vars",
        },
      },
    ]);
  });

  it("fails an await-ci park whose red sha was already reported, rather than looping on it", async () => {
    const d = deps({
      listOpenLoopRuns: async () => [
        {
          id: "run-1",
          repo: "acme/widgets",
          status: "running",
          args: { pr_number: 12, ci_feedback_sha: "deadbeef" },
          graph,
        },
      ],
      listStationRuns: async () => parkedAtCi,
      listChecks: async () => [redCheck],
    });

    await prReadyCheckSweep(d.deps);

    expect(d.reported[0]).toMatchObject({
      outcome: "failed",
      args: { reason: "ci_red_unchanged" },
    });
  });

  it("ignores Lore's own check when judging a round, so a draft never waits on its review", async () => {
    const d = deps({
      listStationRuns: async () => parkedAtCi,
      listChecks: async () => [
        { name: "test", status: "completed", conclusion: "success" },
        { name: "lore/code-review", status: "in_progress", conclusion: null },
      ],
    });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toMatchObject([{ outcome: "success" }]);
  });

  it("waits on an await-ci park whose head moved to a commit CI skipped", async () => {
    const d = deps({
      listStationRuns: async () => parkedAtCi,
      listPrCommits: async () => [
        {
          sha: "deadbeef",
          message: "feat: a round",
          date: "2026-09-09T10:00:00Z",
        },
        {
          sha: "f0rmatted",
          message: "style: prettier [skip ci]",
          date: "2026-09-09T10:05:00Z",
        },
      ],
      listChecks: async (_repo, ref) =>
        ref === "deadbeef"
          ? [{ name: "test", status: "in_progress", conclusion: null }]
          : [],
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
    expect(summary).toBe("checked 1, resumed 0, blocked 0, waiting 1");
  });
});
