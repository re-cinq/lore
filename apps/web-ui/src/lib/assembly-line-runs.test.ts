import { describe, it, expect } from "vitest";
import {
  toAssemblyLineRun,
  toAssemblyLineRunNode,
  type AssemblyLineRunRow,
  type AssemblyLineRunNodeRow,
} from "./assembly-line-runs";

const baseRow: AssemblyLineRunRow = {
  id: "al-1",
  definition_name: "implementation",
  task_id: "task-9",
  repo: "re-cinq/lore",
  branch: "lore/impl-x",
  status: "finished",
  outcome: "pr_created",
  reason: null,
  created_at: "2026-07-14T10:00:00Z",
  started_at: "2026-07-14T10:00:05Z",
  finished_at: "2026-07-14T10:12:00Z",
  args_pr_number: null,
  pr_url: "https://github.com/re-cinq/lore/pull/42",
  task_pr_number: 42,
  created_by: "gedaiu",
  cost_usd: 0.1234,
};

describe("toAssemblyLineRun", () => {
  it("resolves the PR from the task join when pr_url is set", () => {
    expect(toAssemblyLineRun(baseRow)).toMatchObject({
      id: "al-1",
      definitionName: "implementation",
      taskId: "task-9",
      prUrl: "https://github.com/re-cinq/lore/pull/42",
      prNumber: 42,
      createdBy: "gedaiu",
      costUsd: 0.1234,
      durationSeconds: 715,
    });
  });

  it("builds a github pull link from args.pr_number for a code-review run without a task PR", () => {
    const run = toAssemblyLineRun({
      ...baseRow,
      task_id: null,
      pr_url: null,
      task_pr_number: null,
      created_by: null,
      cost_usd: null,
      args_pr_number: 7,
    });

    expect(run).toMatchObject({
      prUrl: "https://github.com/re-cinq/lore/pull/7",
      prNumber: 7,
      taskId: null,
      createdBy: null,
      costUsd: null,
    });
  });

  it("maps a run with no task and no PR to null pr/creator/cost", () => {
    const run = toAssemblyLineRun({
      ...baseRow,
      task_id: null,
      pr_url: null,
      task_pr_number: null,
      created_by: null,
      cost_usd: null,
      args_pr_number: null,
    });

    expect(run.prUrl).toBeNull();
    expect(run.prNumber).toBeNull();
    expect(run.createdBy).toBeNull();
    expect(run.costUsd).toBeNull();
  });

  it("leaves duration null for a run that has not finished", () => {
    expect(
      toAssemblyLineRun({ ...baseRow, started_at: null, finished_at: null })
        .durationSeconds,
    ).toBeNull();
  });
});

describe("toAssemblyLineRunNode", () => {
  it("maps a node row and computes its duration", () => {
    const row: AssemblyLineRunNodeRow = {
      node_id: "implement",
      iteration: 1,
      outcome: "success",
      agent_cr_name: "a1b2c3d4-implement",
      commit_sha: "deadbeef",
      started_at: "2026-07-14T10:00:05Z",
      finished_at: "2026-07-14T10:01:05Z",
    };

    expect(toAssemblyLineRunNode(row)).toEqual({
      nodeId: "implement",
      iteration: 1,
      outcome: "success",
      agentCrName: "a1b2c3d4-implement",
      commitSha: "deadbeef",
      durationSeconds: 60,
      startedAt: "2026-07-14T10:00:05Z",
    });
  });

  it("leaves duration null for a still-running node", () => {
    expect(
      toAssemblyLineRunNode({
        node_id: "review",
        iteration: 1,
        outcome: null,
        agent_cr_name: null,
        commit_sha: null,
        started_at: "2026-07-14T10:00:05Z",
        finished_at: null,
      }).durationSeconds,
    ).toBeNull();
  });
});
