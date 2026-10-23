// The spec upkeep loop in the shared loop sections: its weekly runs and the pull requests they opened. Pure, what the route read is handed in.
import { z } from "zod";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import { isOpenStatus } from "../../../work/floor/floor-run-query.js";
import { loopRowFields, loopSectionsSchema } from "../loops/loop-sections.js";

export const UpkeepRowSchema = z.object({
  /** A run's day (`2026-10-19`), or a pull request's `#40`. */
  ref: z.string(),
  url: z.string().nullable(),
  /** `state`: the run's status, `awaiting review` for its open pull request, or `merged`. */
  ...loopRowFields,
  /** Why the newest run stopped, when it did not succeed. */
  blocked: z.string().nullable(),
});

/** Spec upkeep in the shared loop sections: Current, a run is working; Backlog, always empty (the loop runs every Monday); Parked, the newest run stopped short of a pull request; Awaiting merge, its open pull request once no run works it; Recently addressed, its pull requests merged this week. */
export const SpecUpkeepSchema = loopSectionsSchema(UpkeepRowSchema);

export type UpkeepRow = z.infer<typeof UpkeepRowSchema>;
export type SpecUpkeep = z.infer<typeof SpecUpkeepSchema>;

export interface UpkeepPull {
  number: number;
  title: string;
  url: string;
  createdAt?: string;
  mergedAt?: string;
}

export interface UpkeepQueuesInput {
  /** The line's newest runs, newest first. */
  runs: readonly FloorRunRow[];
  /** Open pull requests on an upkeep branch. */
  open: readonly UpkeepPull[];
  /** Upkeep pull requests merged this week. */
  merged: readonly UpkeepPull[];
}

const DAY_LENGTH = "2026-10-19".length;

export function upkeepQueues(input: UpkeepQueuesInput): SpecUpkeep {
  const working = input.runs.filter((run) => isOpenStatus(run.status));

  return {
    current: working.map(runRow),
    backlog: [],
    parked: stoppedRun(input.runs).map(runRow),
    awaiting_merge:
      working.length > 0
        ? []
        : input.open.map((pull) => pullRow(pull, "awaiting review")),
    recent: input.merged.map((pull) => pullRow(pull, "merged")),
  };
}

/** Only the newest settled run speaks for the loop: an older failure a later run made up for is history. */
function stoppedRun(runs: readonly FloorRunRow[]): FloorRunRow[] {
  const newest = runs.find((run) => !isOpenStatus(run.status));

  return newest && newest.outcome !== "success" ? [newest] : [];
}

function runRow(run: FloorRunRow): UpkeepRow {
  return {
    ref: run.created_at.slice(0, DAY_LENGTH),
    url: run.pr_url,
    title: "Spec upkeep",
    state: run.status,
    blocked: run.outcome === "success" ? null : run.reason,
    run_id: run.id,
    pipeline: run.pipeline,
    created_at: run.created_at,
  };
}

function pullRow(pull: UpkeepPull, state: string): UpkeepRow {
  return {
    ref: `#${pull.number}`,
    url: pull.url,
    title: pull.title,
    state,
    blocked: null,
    run_id: null,
    pipeline: null,
    created_at: pull.mergedAt ?? pull.createdAt ?? null,
  };
}
