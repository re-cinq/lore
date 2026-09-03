// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { toAssemblyRun, toAssemblyRunNode } = await import("./assembly-runs");

import type { AssemblyRunRow, AssemblyRunNodeRow } from "./assembly-runs";

const baseRow: AssemblyRunRow = {
  id: "al-1",
  blueprint_name: "implementation",
  definition_name: "implementation",
  subject_key: null,
  graph: null,
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

describe("toAssemblyRun", () => {
  it("resolves the PR from the task join when pr_url is set", () => {
    expect(toAssemblyRun(baseRow)).toMatchObject({
      id: "al-1",
      blueprintName: "implementation",
      graph: null,
      taskId: "task-9",
      prUrl: "https://github.com/re-cinq/lore/pull/42",
      prNumber: 42,
      createdBy: "gedaiu",
      costUsd: 0.1234,
      durationSeconds: 715,
    });
  });

  it("builds a github pull link from args.pr_number for a code-review run without a task PR", () => {
    const run = toAssemblyRun({
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
    const run = toAssemblyRun({
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
      toAssemblyRun({ ...baseRow, started_at: null, finished_at: null })
        .durationSeconds,
    ).toBeNull();
  });
});

describe("toAssemblyRunNode", () => {
  it("maps a node row and computes its duration", () => {
    const row: AssemblyRunNodeRow = {
      node_id: "implement",
      iteration: 1,
      outcome: "success",
      agent_cr_name: "a1b2c3d4-implement",
      station_run_id: null,
      input: null,
      commit_sha: "deadbeef",
      started_at: "2026-07-14T10:00:05Z",
      finished_at: "2026-07-14T10:01:05Z",
    };

    expect(toAssemblyRunNode(row)).toEqual({
      nodeId: "implement",
      iteration: 1,
      outcome: "success",
      agentCrName: "a1b2c3d4-implement",
      input: null,
      commitSha: "deadbeef",
      durationSeconds: 60,
      startedAt: "2026-07-14T10:00:05Z",
    });
  });

  it("leaves duration null for a still-running node", () => {
    expect(
      toAssemblyRunNode({
        node_id: "review",
        iteration: 1,
        outcome: null,
        station_run_id: null,
        input: null,
        agent_cr_name: null,
        commit_sha: null,
        started_at: "2026-07-14T10:00:05Z",
        finished_at: null,
      }).durationSeconds,
    ).toBeNull();
  });
});
