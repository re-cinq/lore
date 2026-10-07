// The weekly spec upkeep on the external floor: one run per repository that finds drifted statements and statements with no test link, has one agent fix both, and opens one pull request. Lore starts the runs itself, one per repository, because a floor schedule tick starts a single run.
import type { FloorClient } from "@re-cinq/floor-client";
import { errorMessage } from "../../lib/error-classify.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "../../outbound/floor/floor-items.js";
import { startLine } from "../review/floor-line-start.js";

export const SPEC_UPKEEP_LINE = "spec-upkeep";

/** A pull request that rewrites more than a few specs is one nobody reviews. */
export const MAX_DRIFTED_SPECS = 3;
export const MAX_UNLINKED_STATEMENTS = 25;

const BRANCH_PREFIX = "lore/spec-upkeep/";
const DAY_LENGTH = "2026-10-05".length;

/** One branch per run day. The branch is cut only once a detector found something, so a repository with nothing to fix is left with no empty branch. */
export function upkeepBranch(now: Date): string {
  return `${BRANCH_PREFIX}${dayOf(now)}`;
}

function dayOf(now: Date): string {
  return now.toISOString().slice(0, DAY_LENGTH);
}

export interface UpkeepTickDeps {
  floor: { lines: Pick<FloorClient["lines"], "start"> };
  /** The repositories the upkeep covers. */
  repos(): Promise<string[]>;
  /** The branches of the repository's open pull requests. */
  openPrBranches(repo: string): Promise<string[]>;
  now(): Date;
}

type Started = "started" | "skipped" | "failed";

export async function specUpkeepTick(
  params: Readonly<Record<string, unknown>>,
  deps: UpkeepTickDeps,
): Promise<string> {
  const repos =
    typeof params.repo === "string" && params.repo.length > 0
      ? [params.repo]
      : await deps.repos();
  const tally = { started: 0, skipped: 0, failed: 0 };

  for (const repo of repos) {
    tally[await startFor(repo, deps)]++;
  }

  return `spec upkeep: started ${tally.started}, skipped ${tally.skipped}, failed ${tally.failed}`;
}

/** One upkeep pull request open per repository at a time: a second one would edit the same statements on another branch. */
async function startFor(repo: string, deps: UpkeepTickDeps): Promise<Started> {
  try {
    const open = await deps.openPrBranches(repo);

    if (open.some((branch) => branch.startsWith(BRANCH_PREFIX))) {
      return "skipped";
    }
    await startRun(repo, deps);

    return "started";
  } catch (err) {
    console.error(`[spec-upkeep] ${repo}: ${errorMessage(err)}`);

    return "failed";
  }
}

/** Keyed on the day, so a second tick the same day joins the run instead of starting another. */
async function startRun(repo: string, deps: UpkeepTickDeps): Promise<void> {
  const now = deps.now();

  await startLine(deps.floor.lines, SPEC_UPKEEP_LINE, {
    repo: floorRepoOf(repo),
    startItems: {
      repo: gitItem(repo, upkeepBranch(now)),
      upkeep: valueItem(dayOf(now)),
    },
  });
}
