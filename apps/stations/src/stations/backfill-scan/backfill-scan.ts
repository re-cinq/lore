/**
 * Fan the weekly link backfill out to ONE unit per specification.
 *
 * It ran as one job per repository at a 30-minute budget, judging every
 * candidate statement of every spec with a model. A failure anywhere cost the
 * whole repository's pass, and the budget was the only thing bounding it.
 *
 * One specification per unit is the boundary the backfill's own code already
 * had — it loops per spec and opens a pull request per spec — so sharding costs
 * no new seam, and a failure now costs one specification.
 *
 * The cap is the part that must not be forgotten. The 30-minute deadline was
 * acting as an ACCIDENTAL rate limiter on how many PRs a repo could open: a repo
 * with many specs simply ran out of time. Per-spec units remove that bound, so
 * the limit becomes a number someone chose rather than a side effect of a
 * timeout, and what it held back is reported rather than silently dropped.
 */

/** Specs one repository may open backfill PRs for in a single run. */
export const BACKFILL_SPECS_PER_REPO = 10;

export interface BackfillScanDeps {
  /** Repos with specs worth backfilling. */
  repos(): Promise<string[]>;
  /** The spec paths in one repo that have un-linked testable statements. */
  specsFor(repo: string): Promise<string[]>;
  /** Start one backfill unit for one spec; returns its run id. */
  startBackfill(repo: string, specPath: string): Promise<string>;
}

interface RepoScanOutcome {
  started: number;
  heldBack: number;
  failed: boolean;
}

/** Scan one repo, catching its own failure so one unreadable repo cannot cost
 * every other repo its run. Counts already accrued survive a mid-repo failure. */
async function scanRepoForBackfill(
  deps: BackfillScanDeps,
  repo: string,
): Promise<RepoScanOutcome> {
  let started = 0;
  let heldBack = 0;

  try {
    const specs = await deps.specsFor(repo);
    const take = specs.slice(0, BACKFILL_SPECS_PER_REPO);

    heldBack = specs.length - take.length;

    for (const specPath of take) {
      await deps.startBackfill(repo, specPath);
      started++;
    }

    return { started, heldBack, failed: false };
  } catch (err) {
    console.error(
      `[station] backfill-scan: could not scan ${repo}:`,
      (err as Error).message,
    );

    return { started, heldBack, failed: true };
  }
}

export async function scanForBackfill(deps: BackfillScanDeps): Promise<string> {
  let started = 0;
  let heldBack = 0;
  let failed = 0;

  for (const repo of await deps.repos()) {
    const outcome = await scanRepoForBackfill(deps, repo);

    started += outcome.started;
    heldBack += outcome.heldBack;
    failed += outcome.failed ? 1 : 0;
  }

  const parts = [`started ${started} spec unit(s)`];

  if (heldBack > 0) {
    parts.push(
      `${heldBack} held back over the ${BACKFILL_SPECS_PER_REPO}/repo cap`,
    );
  }

  if (failed > 0) {
    parts.push(`${failed} repo failed`);
  }

  return parts.join("; ");
}
