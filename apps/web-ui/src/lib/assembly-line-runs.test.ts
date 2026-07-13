import { describe, it, expect } from "vitest";
import {
  toAssemblyLineRun,
  type AssemblyLineRunRow,
} from "./assembly-line-runs";

const row = (over: Partial<AssemblyLineRunRow> = {}): AssemblyLineRunRow => ({
  id: "11111111-2222-4333-8444-555555555555",
  definition_name: "implementation",
  task_id: "task-9",
  repo: "re-cinq/lore",
  branch: "lore/implementation/widget-abcd1234",
  status: "finished",
  outcome: "completed",
  reason: null,
  created_at: "2026-07-03T10:00:00.000Z",
  started_at: "2026-07-03T10:00:05.000Z",
  finished_at: "2026-07-03T10:12:00.000Z",
  node_count: "5",
  ...over,
});

describe("toAssemblyLineRun", () => {
  it("maps a finished row with its node count and duration", () => {
    expect(toAssemblyLineRun(row())).toEqual({
      id: "11111111-2222-4333-8444-555555555555",
      definitionName: "implementation",
      taskId: "task-9",
      repo: "re-cinq/lore",
      branch: "lore/implementation/widget-abcd1234",
      status: "finished",
      outcome: "completed",
      reason: null,
      createdAt: "2026-07-03T10:00:00.000Z",
      nodeCount: 5,
      durationSeconds: 715,
    });
  });

  it("maps a running row: zero nodes yet, no duration", () => {
    const run = toAssemblyLineRun(
      row({
        status: "running",
        outcome: null,
        finished_at: null,
        node_count: "0",
      }),
    );
    expect(run).toMatchObject({
      status: "running",
      outcome: null,
      nodeCount: 0,
      durationSeconds: null,
    });
  });

  it("maps a queued row that never started", () => {
    const run = toAssemblyLineRun(
      row({
        status: "queued",
        outcome: null,
        started_at: null,
        finished_at: null,
        node_count: "0",
      }),
    );
    expect(run).toMatchObject({ status: "queued", durationSeconds: null });
  });
});
