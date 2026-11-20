// The scheduled release's tick (specs/scheduled-releases): start one release run on the floor per repository whose schedule is due. A day with nothing merged ends its run empty and stores no release, so the tick marks each repository once its run started, and starts it once per local day.
import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { startRelease } from "@re-cinq/lore-shared/release/floor-release.js";
import { decideReleaseDue } from "@re-cinq/lore-shared/release/decide-release-due.js";
import {
  releaseEnabled,
  resolveReleaseSettings,
} from "@re-cinq/lore-shared/release-settings.js";
import type { ChangelogReleasesPort } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-port.js";
import type { OnboardedRepoSettings } from "@re-cinq/lore-shared/project/settings/settings-port.js";

type Floor = ReturnType<typeof floorClient>;

export interface ReleaseTickDeps {
  floor: { lines: Pick<Floor["lines"], "start"> };
  repoSettings(): Promise<OnboardedRepoSettings[]>;
  releases: Pick<
    ChangelogReleasesPort,
    "latest" | "markScheduledAttempt" | "lastScheduledAttempt"
  >;
  headSha(repo: string): Promise<string>;
  now(): Date;
}

/** One repository that cannot be started is logged and left unmarked, so the next tick tries it again, never the whole tick. */
export async function releaseTick(deps: ReleaseTickDeps): Promise<string> {
  const enabled = (await deps.repoSettings()).filter(({ settings }) =>
    releaseEnabled(settings),
  );
  const due = (
    await Promise.all(enabled.map((entry) => dueRepo(entry, deps)))
  ).flat();
  const started = await Promise.all(due.map((repo) => startOrLog(repo, deps)));

  return `started ${started.filter(Boolean).length} of ${due.length} due repo(s)`;
}

async function dueRepo(
  { full_name, settings }: OnboardedRepoSettings,
  deps: ReleaseTickDeps,
): Promise<string[]> {
  const lastRunAt = latestInstant(
    (await deps.releases.latest(full_name))?.rangeTo ?? null,
    await deps.releases.lastScheduledAttempt(full_name),
  );
  const due = decideReleaseDue({
    settings: resolveReleaseSettings(settings?.release),
    now: deps.now(),
    lastReleasedAt: lastRunAt,
  });

  return due ? [full_name] : [];
}

/** The later of the last stored release's end and the last scheduled attempt: either one counts as the day's run. */
export function latestInstant(
  releasedAt: Date | null,
  attemptedAt: Date | null,
): Date | null {
  const instants = [releasedAt, attemptedAt].flatMap((at) => at ?? []);

  return instants.length === 0
    ? null
    : new Date(Math.max(...instants.map((at) => at.getTime())));
}

async function startOrLog(
  repo: string,
  deps: ReleaseTickDeps,
): Promise<boolean> {
  try {
    await startRelease(deps.floor.lines, {
      repo,
      sha: await deps.headSha(repo),
    });
    await deps.releases.markScheduledAttempt(repo, deps.now());

    return true;
  } catch (err) {
    console.error(`[release] ${repo}: ${(err as Error).message}`);

    return false;
  }
}
