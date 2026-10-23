import { describe, expect, it } from "vitest";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import { mergeQueues, type MergeQueuesInput } from "./merge-queues.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const url = (n: number) => `https://github.com/acme/widgets/pull/${n}`;

const pull = (n: number, createdAt = "2026-10-20T12:00:00Z") => ({
  number: n,
  title: `Change ${n}`,
  url: url(n),
  createdAt,
});

const run = (n: number, over: Partial<FloorRunRow> = {}): FloorRunRow =>
  ({
    id: `run-${n}`,
    pr_url: url(n),
    status: "running",
    outcome: null,
    reason: null,
    created_at: "2026-10-23T10:00:00Z",
    pipeline: [{ node_id: "fix-pr", state: "running" }],
    ...over,
  }) as FloorRunRow;

const input = (over: Partial<MergeQueuesInput>): MergeQueuesInput => ({
  open: [],
  reviewed: new Set(),
  runs: [],
  merged: [],
  blocks: [],
  minAgeHours: 24,
  now: NOW,
  ...over,
});

const keys = (
  rows: { pr_number: number; state: string; blocked: string | null }[],
) => rows.map((r) => [r.pr_number, r.state, r.blocked]);

describe("mergeQueues", () => {
  it("puts reviewed #1 with no run in the backlog, #2 being fixed under current, and leaves out unreviewed #3", () => {
    const queues = mergeQueues(
      input({
        open: [pull(1), pull(2), pull(3)],
        reviewed: new Set([1, 2]),
        runs: [run(2)],
      }),
    );

    expect({
      backlog: keys(queues.backlog),
      current: keys(queues.current),
    }).toEqual({
      backlog: [[1, "reviewed", null]],
      current: [[2, "running", null]],
    });
  });

  it("shows #4, waiting at its gate and opened 2 hours ago, as awaiting merge with the time it may merge", () => {
    const queues = mergeQueues(
      input({
        open: [pull(4, "2026-10-23T10:00:00Z")],
        runs: [
          run(4, { pipeline: [{ node_id: "await-merge", state: "waiting" }] }),
        ],
      }),
    );

    expect(keys(queues.awaiting_merge)).toEqual([
      [4, "waiting", "merges after 2026-10-24 10:00 UTC"],
    ]);
  });

  it("keeps #8, opened 2 hours ago and waiting at its gate for CI, under current with its blocked reason", () => {
    const queues = mergeQueues(
      input({
        open: [pull(8, "2026-10-23T10:00:00Z")],
        runs: [
          run(8, { pipeline: [{ node_id: "await-merge", state: "waiting" }] }),
        ],
        blocks: [{ prNumber: 8, reason: "waiting_on_ci", detail: null }],
      }),
    );

    expect({
      current: keys(queues.current),
      awaiting: keys(queues.awaiting_merge),
    }).toEqual({
      current: [[8, "running", "Waiting for CI"]],
      awaiting: [],
    });
  });

  it("shows #5 whose run approved it as armed, and parks #6 whose run failed and #7 armed but needing a code owner", () => {
    const queues = mergeQueues(
      input({
        open: [pull(5), pull(6), pull(7)],
        runs: [
          run(5, { status: "completed", outcome: "success" }),
          run(6, {
            status: "failed",
            outcome: "failed",
            reason: "needs the lore-reviewer App",
          }),
          run(7, { status: "completed", outcome: "success" }),
        ],
        blocks: [{ prNumber: 7, reason: "needs_code_owner", detail: null }],
      }),
    );

    expect({
      awaiting: keys(queues.awaiting_merge),
      parked: keys(queues.parked),
    }).toEqual({
      awaiting: [[5, "armed", null]],
      parked: [
        [6, "blocked", "needs the lore-reviewer App"],
        [7, "blocked", "Needs a code owner's approval"],
      ],
    });
  });

  it("lists under recent only merged pull requests the loop worked, newest first", () => {
    const queues = mergeQueues(
      input({
        merged: [
          { ...pull(8), mergedAt: "2026-10-22T09:00:00Z" },
          { ...pull(9), mergedAt: "2026-10-23T09:00:00Z" },
          { ...pull(10), mergedAt: "2026-10-23T11:00:00Z" },
        ],
        runs: [
          run(8, { status: "completed", outcome: "success" }),
          run(9, { status: "completed", outcome: "success" }),
        ],
      }),
    );

    expect(queues.recent.map((r) => [r.pr_number, r.state])).toEqual([
      [9, "merged"],
      [8, "merged"],
    ]);
  });
});
