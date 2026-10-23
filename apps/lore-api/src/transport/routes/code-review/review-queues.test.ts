import { describe, expect, it } from "vitest";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import { reviewQueues } from "./review-queues.js";

const PULL = (number: number) => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/acme/widgets/pull/${number}`,
});

const DRAFT = (number: number) => ({ ...PULL(number), draft: true });

function run(
  over: Partial<FloorRunRow> & { id: string; pr: number | null },
): FloorRunRow {
  const { pr, ...rest } = over;

  return {
    blueprint_name: "code-review",
    definition_name: "code-review",
    task_id: null,
    repo: "acme/widgets",
    branch: null,
    subject_key: null,
    engine: "floor",
    status: "completed",
    outcome: "success",
    reason: null,
    created_at: "2026-10-23T10:00:00.000Z",
    started_at: null,
    finished_at: null,
    args_pr_number: pr,
    spec_plan_summary: null,
    pr_url: pr === null ? null : PULL(pr).url,
    task_pr_number: null,
    issue_url: null,
    issue_number: null,
    created_by: null,
    cost_usd: null,
    pipeline: [],
    ...rest,
  } as FloorRunRow;
}

describe("reviewQueues", () => {
  it("puts #7 with a running review under current and the other open pull requests after it", () => {
    const queues = reviewQueues(
      [PULL(7), PULL(8), DRAFT(9)],
      [run({ id: "r1", pr: 7, status: "running", outcome: null })],
    );

    expect({
      current: queues.current.map((r) => [r.pr_number, r.line, r.state]),
      open: queues.open_pulls.map((r) => [r.pr_number, r.state, r.draft]),
      recent: queues.recent,
    }).toEqual({
      current: [[7, "review", "running"]],
      open: [
        [8, "unreviewed", false],
        [9, "draft", true],
      ],
      recent: [],
    });
  });

  it("gives an open pull request its newest settled run, newest first, and lists it under recent too", () => {
    const queues = reviewQueues(
      [PULL(8)],
      [
        run({
          id: "old",
          pr: 8,
          outcome: "changes_requested",
          created_at: "2026-10-22T10:00:00.000Z",
        }),
        run({
          id: "new",
          pr: 8,
          blueprint_name: "code-review-recheck",
          created_at: "2026-10-23T10:00:00.000Z",
        }),
      ],
    );

    expect({
      open: queues.open_pulls.map((r) => [r.run_id, r.line, r.state]),
      recent: queues.recent.map((r) => r.run_id),
    }).toEqual({
      open: [["new", "re-check", "success"]],
      recent: ["new"],
    });
  });

  it("names a settled run's pull request from its number when it is no longer open, and keeps recent to ten", () => {
    const runs = Array.from({ length: 12 }, (_, i) =>
      run({
        id: `r${i}`,
        pr: 100 + i,
        created_at: `2026-10-${String(1 + i).padStart(2, "0")}T10:00:00.000Z`,
      }),
    );
    const queues = reviewQueues([], runs);

    expect({
      count: queues.recent.length,
      first: [queues.recent[0].run_id, queues.recent[0].title],
    }).toEqual({ count: 10, first: ["r11", "Pull request #111"] });
  });
});
