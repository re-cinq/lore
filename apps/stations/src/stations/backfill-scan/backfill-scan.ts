// Fans the weekly link backfill out to ONE unit per specification, not per repo: the old 30-min-per-repo budget cost a whole repo's pass on one failure and silently rate-limited PRs via timeout; per-spec units bound the failure to one spec and make the per-repo cap (BACKFILL_SPECS_PER_REPO) an explicit, reported choice instead.

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

// Scans one repo, catching its own failure so one unreadable repo cannot cost every other repo its run; counts already accrued survive a mid-repo failure.
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
