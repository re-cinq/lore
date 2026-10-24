// The spec tickets loop in the shared loop sections: one row per spec, from the line's newest runs. Pure, what the route read is handed in.
import { z } from "zod";
import { specNameOfRunKey } from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import { isOpenStatus } from "../../../work/floor/floor-run-query.js";
import { loopRowFields, loopSectionsSchema } from "../loops/loop-sections.js";

export const TicketsRowSchema = z.object({
  /** The spec's directory name, `widgets` for `specs/widgets/spec.md`. */
  ref: z.string(),
  url: z.string().nullable(),
  /** `state`: the run's status. */
  ...loopRowFields,
  /** Why the run stopped, when it did not succeed. */
  blocked: z.string().nullable(),
});

/** Spec tickets in the shared loop sections: Current, a spec being split now; Parked, a spec whose newest run failed; Recently addressed, the specs ticketed in the last seven days. Backlog and Awaiting merge stay empty: the loop starts on a merge, and files issues rather than pull requests. */
export const SpecTicketsSchema = loopSectionsSchema(TicketsRowSchema);

export type TicketsRow = z.infer<typeof TicketsRowSchema>;
export type SpecTickets = z.infer<typeof SpecTicketsSchema>;

export interface TicketsQueuesInput {
  /** The line's newest runs, newest first. */
  runs: readonly FloorRunRow[];
  /** Runs settled before this are not recent. */
  since: string;
}

export function ticketsQueues({
  runs,
  since,
}: TicketsQueuesInput): SpecTickets {
  const perSpec = newestPerSpec(runs);

  return {
    current: perSpec.filter((run) => isOpenStatus(run.status)).map(row),
    backlog: [],
    parked: perSpec.filter(stopped).map(row),
    awaiting_merge: [],
    recent: perSpec
      .filter((run) => run.outcome === "success" && run.created_at >= since)
      .map(row),
  };
}

/** Only a spec's newest run speaks for it: a failure a later merge's run made up for is history. */
function newestPerSpec(runs: readonly FloorRunRow[]): FloorRunRow[] {
  const seen = new Set<string>();

  return runs.filter((run) => {
    const name = specNameOfRunKey(run.subject_key);

    if (name === null || seen.has(name)) {
      return false;
    }
    seen.add(name);

    return true;
  });
}

const stopped = (run: FloorRunRow): boolean =>
  !isOpenStatus(run.status) && run.outcome !== "success";

function row(run: FloorRunRow): TicketsRow {
  return {
    ref: specNameOfRunKey(run.subject_key) ?? run.id,
    url: null,
    title: `specs/${specNameOfRunKey(run.subject_key) ?? "?"}/spec.md`,
    state: run.status,
    blocked: stopped(run) ? run.reason : null,
    run_id: run.id,
    pipeline: run.pipeline,
    created_at: run.created_at,
  };
}
