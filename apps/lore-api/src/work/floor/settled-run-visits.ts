// A finished run's visits, kept: nothing visits a run after it settles, so the floor is asked for them once. The Loops board lists some 300 runs a load, nearly all finished, and asked the floor for each one's visits every time.
import type { RunView, VisitView } from "@re-cinq/floor-client";

type VisitsOf = (runId: string) => Promise<VisitView[]>;

/** How many finished runs are remembered; the oldest kept is dropped past it. */
const KEPT_RUNS = 5_000;

/** A read of a run's visits that asks the floor every time for an open run and once for a finished one. A run started again by hand is open again, and settles with a new finish time, so its kept visits are never answered for it. */
export function keepingSettledVisits(
  read: VisitsOf,
): (run: RunView) => Promise<VisitView[]> {
  const kept = new Map<string, Promise<VisitView[]>>();

  return (run) => {
    if (!run.finishedAt) {
      return read(run.id);
    }
    const key = `${run.id}@${run.finishedAt}`;
    const known = kept.get(key);

    if (known) {
      return known;
    }
    const reading = read(run.id);

    remember(kept, key, reading);

    return reading;
  };
}

/** A failed read is forgotten, so the next ask reads again. */
function remember(
  kept: Map<string, Promise<VisitView[]>>,
  key: string,
  reading: Promise<VisitView[]>,
): void {
  kept.set(key, reading);
  reading.catch(() => kept.delete(key));

  if (kept.size > KEPT_RUNS) {
    const [oldest] = kept.keys();

    kept.delete(oldest);
  }
}
