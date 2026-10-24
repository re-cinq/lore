// What a run cost, as the floor sums it: one read for a run, one for a whole page of them.
import type { FloorClient } from "@re-cinq/floor-client";

type Costs = Pick<FloorClient["costs"], "summary">;

export async function costUsdOf(
  costs: Costs,
  runId: string,
): Promise<number | null> {
  const totals = await costs.summary({ run: runId }, "run");

  return totals.at(0)?.costUsd ?? null;
}

/** The cost of each run, in ONE read: the list page asks once, not once per row. A lone run asks for just its own; several ask for everything since the oldest began. */
export async function costsByRunOf(
  costs: Costs,
  runs: readonly { id: string; createdAt: Date }[],
): Promise<Map<string, number>> {
  const oldest = Math.min(...runs.map((run) => run.createdAt.getTime()));
  const filter =
    runs.length === 1
      ? { run: runs[0].id }
      : { since: new Date(oldest).toISOString() };
  const totals = await costs.summary(filter, "run");

  return new Map(
    totals.flatMap((row) => (row.key === null ? [] : [[row.key, row.costUsd]])),
  );
}
