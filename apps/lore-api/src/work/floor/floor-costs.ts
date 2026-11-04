// What a run cost, as the floor sums it: one read for a run, one per run for a short list, one for a long page of them.
import type { FloorClient } from "@re-cinq/floor-client";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";

type Costs = Pick<FloorClient["costs"], "summary">;
type CostsFilter = Parameters<Costs["summary"]>[0];

/** Up to this many runs are read one `{ run }` at a time. The `{ since }` sum covers every run in the org from the oldest one on and grows with that span (28 s for a plan whose runs went back three weeks), so only a long page, such as the 50-row run list, is worth it. */
const PER_RUN_READS_UP_TO = 10;

export async function costUsdOf(
  costs: Costs,
  runId: string,
): Promise<number | null> {
  const totals = await costs.summary({ run: runId }, "run");

  return totals.at(0)?.costUsd ?? null;
}

/** The cost of each run. A list of up to ten asks for each run's own cost, in parallel; a longer one asks once for everything since the oldest began. A failed read is logged and drops only the runs it was for, so a slow floor costs the list its costs, never the list. */
export async function costsByRunOf(
  costs: Costs,
  runs: readonly { id: string; createdAt: Date }[],
): Promise<Map<string, number>> {
  const settled = await Promise.allSettled(
    filtersFor(runs).map((filter) => costs.summary(filter, "run")),
  );

  warnFailed(settled);

  return new Map(
    settled.flatMap((read) =>
      read.status === "rejected" ? [] : costRowsOf(read.value),
    ),
  );
}

type Totals = Awaited<ReturnType<Costs["summary"]>>;

function costRowsOf(totals: Totals): (readonly [string, number])[] {
  return totals.flatMap((row) =>
    row.key === null ? [] : [[row.key, row.costUsd] as const],
  );
}

function warnFailed(settled: PromiseSettledResult<Totals>[]): void {
  const failed = settled.filter((read) => read.status === "rejected");

  if (failed.length > 0) {
    console.warn(
      `[floor-runs] ${failed.length} of ${settled.length} cost reads failed: ${errorMessage(failed[0].reason)}`,
    );
  }
}

function filtersFor(
  runs: readonly { id: string; createdAt: Date }[],
): CostsFilter[] {
  if (runs.length <= PER_RUN_READS_UP_TO) {
    return runs.map((run) => ({ run: run.id }));
  }

  const oldest = Math.min(...runs.map((run) => run.createdAt.getTime()));

  return [{ since: new Date(oldest).toISOString() }];
}
