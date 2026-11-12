// The weekly spec upkeep on the external floor: one run per repository that finds drifted statements and statements with no test link, has one agent fix both, and opens one pull request. Lore starts the runs itself, one per repository, because a floor schedule tick starts a single run.
import type { FloorClient, RunView } from "@re-cinq/floor-client";
import { errorMessage } from "../../lib/error-classify.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "../../outbound/floor/floor-items.js";
import { startLine } from "../review/floor-line-start.js";
import { specUpkeepEnabled } from "../../domain/loops/loop-enabled.js";

export const SPEC_UPKEEP_LINE = "spec-upkeep";

/** A pull request that rewrites more than a few specs is one nobody reviews. */
export const MAX_DRIFTED_SPECS = 3;
export const MAX_UNLINKED_STATEMENTS = 25;

/** On a first-run backfill across many repositories, capping starts per tick prevents a PR flood. */
export const MAX_RUNS_PER_TICK = 10;

/** Every upkeep pull request's branch starts with it, which is how the Loops tab finds them. */
export const UPKEEP_BRANCH_PREFIX = "lore/spec-upkeep/";
const DAY_LENGTH = "2026-10-05".length;

/** One branch per run day. The branch is cut only once a detector found something, so a repository with nothing to fix is left with no empty branch. */
export function upkeepBranch(now: Date): string {
  return `${UPKEEP_BRANCH_PREFIX}${dayOf(now)}`;
}

function dayOf(now: Date): string {
  return now.toISOString().slice(0, DAY_LENGTH);
}

/** The onboarded repositories whose spec upkeep loop is on, sorted. */
export function enabledUpkeepRepos(
  rows: readonly { full_name: string; settings: unknown }[],
): string[] {
  return rows
    .filter((row) => specUpkeepEnabled(row.settings))
    .map((row) => row.full_name)
    .sort();
}

export interface UpkeepTickDeps {
  floor: {
    lines: Pick<FloorClient["lines"], "start">;
    runs: Pick<FloorClient["runs"], "list">;
  };
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
  const repos = await dueRepos(params, deps);
  const tally = { started: 0, skipped: 0, failed: 0 };

  for (const repo of repos) {
    if (tally.started >= MAX_RUNS_PER_TICK) {
      break;
    }
    tally[await startFor(repo, deps)]++;
  }

  return `spec upkeep: started ${tally.started}, skipped ${tally.skipped}, failed ${tally.failed}`;
}

const PRIOR_RUNS_LIMIT = 200;

async function dueRepos(
  params: Readonly<Record<string, unknown>>,
  deps: UpkeepTickDeps,
): Promise<string[]> {
  if (typeof params.repo === "string" && params.repo.length > 0) {
    return [params.repo];
  }
  const { runs } = deps.floor;
  const [repos, { items: priorRuns }] = await Promise.all([
    deps.repos(),
    runs.list({ line: SPEC_UPKEEP_LINE }, { limit: PRIOR_RUNS_LIMIT }),
  ]);

  return upkeepRepoOrder(repos, priorRuns);
}

/** Repositories with no prior spec-upkeep run first, then the one whose newest run started earliest. */
export function upkeepRepoOrder(
  repos: readonly string[],
  runs: readonly Pick<RunView, "repo" | "createdAt">[],
): string[] {
  const starts = lastRepoStarts(runs);
  const startOf = (repo: string) => starts.get(floorRepoOf(repo)) ?? "";

  return [...repos].sort((a, b) => startOf(a).localeCompare(startOf(b)));
}

function lastRepoStarts(
  runs: readonly Pick<RunView, "repo" | "createdAt">[],
): Map<string | null, string> {
  const starts = new Map<string | null, string>();

  for (const { repo, createdAt } of runs) {
    if (createdAt > (starts.get(repo) ?? "")) {
      starts.set(repo, createdAt);
    }
  }

  return starts;
}

/** One upkeep pull request open per repository at a time: a second one would edit the same statements on another branch. */
async function startFor(repo: string, deps: UpkeepTickDeps): Promise<Started> {
  try {
    const open = await deps.openPrBranches(repo);

    if (open.some((branch) => branch.startsWith(UPKEEP_BRANCH_PREFIX))) {
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
