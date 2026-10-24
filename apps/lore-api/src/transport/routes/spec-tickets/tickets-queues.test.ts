import { describe, expect, it } from "vitest";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import { ticketsQueues } from "./tickets-queues.js";

const SINCE = "2026-10-17T00:00:00Z";

const run = (
  id: string,
  spec: string,
  over: Partial<FloorRunRow> = {},
): FloorRunRow =>
  ({
    id,
    subject_key: `key:acme/widgets:specs/${spec}/spec.md@${id}`,
    status: "running",
    outcome: null,
    reason: null,
    created_at: "2026-10-20T10:00:00Z",
    pipeline: [{ node_id: "decompose", state: "running" }],
    ...over,
  }) as FloorRunRow;

const keys = (rows: { ref: string; state: string; blocked: string | null }[]) =>
  rows.map((row) => [row.ref, row.state, row.blocked]);

describe("ticketsQueues", () => {
  it("puts the widgets spec being split under current, titled by its path and linked to its run", () => {
    const queues = ticketsQueues({
      runs: [run("r1", "widgets")],
      since: SINCE,
    });

    expect({
      current: queues.current.map((row) => [row.ref, row.title, row.run_id]),
      backlog: queues.backlog,
      awaiting: queues.awaiting_merge,
    }).toEqual({
      current: [["widgets", "specs/widgets/spec.md", "r1"]],
      backlog: [],
      awaiting: [],
    });
  });

  it("parks the billing spec whose newest run failed with its reason, lists widgets ticketed this week under recent, and leaves out a success from 2 weeks ago", () => {
    const queues = ticketsQueues({
      runs: [
        run("r3", "billing", {
          status: "failed",
          outcome: "failed",
          reason: "decompose broke",
        }),
        run("r2", "widgets", { status: "completed", outcome: "success" }),
        run("r1", "old", {
          status: "completed",
          outcome: "success",
          created_at: "2026-10-03T10:00:00Z",
        }),
      ],
      since: SINCE,
    });

    expect({
      parked: keys(queues.parked),
      recent: keys(queues.recent),
      current: queues.current,
    }).toEqual({
      parked: [["billing", "failed", "decompose broke"]],
      recent: [["widgets", "completed", null]],
      current: [],
    });
  });

  it("lets a spec's newer successful run outrank the failed one before it, so billing is recent and not parked", () => {
    const queues = ticketsQueues({
      runs: [
        run("r5", "billing", { status: "completed", outcome: "success" }),
        run("r4", "billing", {
          status: "failed",
          outcome: "failed",
          reason: "decompose broke",
          created_at: "2026-10-19T10:00:00Z",
        }),
      ],
      since: SINCE,
    });

    expect({ parked: queues.parked, recent: keys(queues.recent) }).toEqual({
      parked: [],
      recent: [["billing", "completed", null]],
    });
  });
});
