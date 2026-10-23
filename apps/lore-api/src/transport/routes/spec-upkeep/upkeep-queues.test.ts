import { describe, expect, it } from "vitest";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import { upkeepQueues } from "./upkeep-queues.js";

const PR = (n: number) => `https://github.com/acme/widgets/pull/${n}`;

const run = (id: string, over: Partial<FloorRunRow> = {}): FloorRunRow =>
  ({
    id,
    pr_url: null,
    status: "running",
    outcome: null,
    reason: null,
    created_at: "2026-10-19T10:00:00Z",
    pipeline: [{ node_id: "update-specs", state: "running" }],
    ...over,
  }) as FloorRunRow;

const pull = (n: number, over: Record<string, string> = {}) => ({
  number: n,
  title: `Spec upkeep ${n}`,
  url: PR(n),
  createdAt: "2026-10-19T11:00:00Z",
  ...over,
});

const keys = (rows: { ref: string; state: string; blocked: string | null }[]) =>
  rows.map((row) => [row.ref, row.state, row.blocked]);

describe("upkeepQueues", () => {
  it("puts the open run of 2026-10-19 under current and leaves its pull request #40 out of awaiting merge until the run ends", () => {
    const queues = upkeepQueues({
      runs: [run("run-1")],
      open: [pull(40)],
      merged: [],
    });

    expect({
      current: keys(queues.current),
      awaiting: keys(queues.awaiting_merge),
    }).toEqual({ current: [["2026-10-19", "running", null]], awaiting: [] });
  });

  it("shows open #40 as awaiting merge once no run works it, parks the newest failed run with its reason, and lists merged #39 under recent", () => {
    const queues = upkeepQueues({
      runs: [
        run("run-2", {
          status: "failed",
          outcome: "failed",
          reason: "ci stayed red",
          created_at: "2026-10-12T10:00:00Z",
        }),
      ],
      open: [pull(40)],
      merged: [pull(39, { mergedAt: "2026-10-20T09:00:00Z" })],
    });

    expect({
      awaiting: keys(queues.awaiting_merge),
      parked: keys(queues.parked),
      recent: keys(queues.recent),
      backlog: queues.backlog,
    }).toEqual({
      awaiting: [["#40", "open", null]],
      parked: [["2026-10-12", "failed", "ci stayed red"]],
      recent: [["#39", "merged", null]],
      backlog: [],
    });
  });
});
