// Which repository a run belongs to, for the check that a person may read it. A run's repository never changes, so an answer is kept for the life of the process.

import type { Pool } from "pg";
import { runsReadingFloor } from "../floor/floor-backed-runs.js";

const MAX_KEPT_RUNS = 5_000;

export type RunRepoReader = (runId: string) => Promise<string | null>;

/** Callers of one run share one read; a read that fails or finds no run is not kept; past the cap the oldest answer is dropped. */
export function keepingRunRepos(
  read: RunRepoReader,
  limit = MAX_KEPT_RUNS,
): RunRepoReader {
  const kept = new Map<string, Promise<string | null>>();

  return (runId) => kept.get(runId) ?? keep(kept, runId, read, limit);
}

function keep(
  kept: Map<string, Promise<string | null>>,
  runId: string,
  read: RunRepoReader,
  limit: number,
): Promise<string | null> {
  const reading: Promise<string | null> = read(runId).then(
    (repo) => forgetUnknown(kept, runId, reading, repo),
    (err: unknown) => {
      forgetUnknown(kept, runId, reading, null);
      throw err;
    },
  );

  kept.set(runId, reading);
  dropOldest(kept, limit);

  return reading;
}

function forgetUnknown(
  kept: Map<string, Promise<string | null>>,
  runId: string,
  reading: Promise<string | null>,
  repo: string | null,
): string | null {
  if (repo === null && kept.get(runId) === reading) {
    kept.delete(runId);
  }

  return repo;
}

function dropOldest(kept: Map<string, unknown>, limit: number): void {
  for (const oldest of kept.keys()) {
    if (kept.size <= limit) {
      return;
    }
    kept.delete(oldest);
  }
}

let production: RunRepoReader | undefined;

/** The repository of a run in Postgres or on the floor; null for an unknown run. */
export function runRepoOf(pool: Pool, runId: string): Promise<string | null> {
  production ??= keepingRunRepos(
    async (id) => (await runsReadingFloor(pool).getById(id))?.repo ?? null,
  );

  return production(runId);
}
