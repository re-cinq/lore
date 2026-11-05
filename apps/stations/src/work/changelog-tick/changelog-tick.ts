// The changelog's tick (specs/repo-changelog): on Mondays, start one weekly-changelog run on the floor per repository for the week that just ended. Over HTTP with `weeks` it backfills the weeks a repository has no changelog for yet.
import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  startChangelogWeek,
  type RepoWeek,
} from "@re-cinq/lore-shared/changelog/floor-changelog-week.js";
import { finishedWeeks } from "@re-cinq/lore-shared/changelog/changelog-week.js";
import type { ChangelogWeeksPort } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-port.js";

const MAX_WEEKS = 12;

type Floor = ReturnType<typeof floorClient>;

export interface ChangelogTickDeps {
  floor: { lines: Pick<Floor["lines"], "start"> };
  repos(): Promise<string[]>;
  weeks: Pick<ChangelogWeeksPort, "writtenWeeks">;
  now(): Date;
}

/** One week that cannot be started is logged and left for the next tick, never the whole tick. */
export async function changelogTick(
  params: Readonly<Record<string, unknown>>,
  deps: ChangelogTickDeps,
): Promise<string> {
  const weeks = finishedWeeks(deps.now(), weekCount(params.weeks));
  const repos =
    typeof params.repo === "string" ? [params.repo] : await deps.repos();
  const missing = (
    await Promise.all(repos.map((repo) => missingWeeks(repo, weeks, deps)))
  ).flat();
  const started = await Promise.all(
    missing.map((entry) => startOrLog(entry, deps)),
  );

  return `started ${started.filter(Boolean).length} of ${missing.length} week(s) without a changelog`;
}

async function startOrLog(
  entry: RepoWeek,
  deps: ChangelogTickDeps,
): Promise<boolean> {
  try {
    await startChangelogWeek(deps.floor.lines, entry);

    return true;
  } catch (err) {
    console.error(
      `[changelog] ${entry.repo} ${entry.week}: ${(err as Error).message}`,
    );

    return false;
  }
}

function weekCount(raw: unknown): number {
  const count = Number(raw ?? 1);

  return Number.isInteger(count) && count > 0 ? Math.min(count, MAX_WEEKS) : 1;
}

async function missingWeeks(
  repo: string,
  weeks: string[],
  deps: ChangelogTickDeps,
): Promise<RepoWeek[]> {
  const written = new Set(await deps.weeks.writtenWeeks(repo, weeks));

  return weeks
    .filter((week) => !written.has(week))
    .map((week) => ({ repo, week }));
}
