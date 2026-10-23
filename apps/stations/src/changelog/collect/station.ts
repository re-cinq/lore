// Collects one repository's finished week on the external floor (specs/repo-changelog): what merged and closed in the ISO week leaves as the file the intro agent reads and the store station writes.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import {
  isoWeekBounds,
  weekChanges,
  type ClosedWork,
  type WeekBounds,
} from "@re-cinq/lore-shared/changelog/changelog-week.js";
import { collectDeps } from "../deps.js";

export interface ChangelogCollectDeps {
  closedWork(repo: string, bounds: WeekBounds): Promise<ClosedWork>;
}

export const NOT_A_WEEK =
  "the run carries no week: changelog_repo and week_key are both needed";

/** `empty` when nothing merged or closed, so the line stores the week without asking the agent about it. */
export function changelogCollectHandle(deps: ChangelogCollectDeps): Handle {
  return async (brief, tools) => {
    const { changelog_repo: repo, week_key: weekKey } = brief.needs;

    if (typeof repo !== "string" || typeof weekKey !== "string") {
      return { outcome: "failed", error: NOT_A_WEEK };
    }

    try {
      const bounds = isoWeekBounds(weekKey);
      const changes = weekChanges(await deps.closedWork(repo, bounds), bounds);
      const week = JSON.stringify({ repo, weekKey, changes });

      await tools.produce("changelog_week", Buffer.from(week));

      return { outcome: changes.length > 0 ? "success" : "empty" };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

export function startChangelogCollectStation(): RunningStation {
  return defineStation(
    "changelog-collect",
    changelogCollectHandle(collectDeps()),
  );
}
