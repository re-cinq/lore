// Stores one repository's finished week from the external floor (specs/repo-changelog): the collected week with the agent's introduction when it left one, without one otherwise.
import {
  defineStation,
  type Brief,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import { ChangelogWeekSchema } from "@re-cinq/lore-shared/models/changelog-week.js";
import type { ChangelogWeeksPort } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-port.js";
import { storeDeps } from "../deps.js";

const WEEK = "changelog_week";
const INTRO = "changelog_intro";

const CollectedWeek = ChangelogWeekSchema.pick({
  repo: true,
  weekKey: true,
  changes: true,
});

export function changelogStoreHandle(
  weeks: Pick<ChangelogWeeksPort, "upsert">,
): Handle {
  return async (brief, tools) => {
    try {
      const week = CollectedWeek.parse(JSON.parse(await textOf(tools, WEEK)));

      await weeks.upsert({ ...week, intro: await introOf(brief, tools) });

      return { outcome: "success" };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

/** The agent's introduction, or empty when the week was empty or the agent left none. */
async function introOf(brief: Brief, tools: Tools): Promise<string> {
  return INTRO in brief.needs ? (await textOf(tools, INTRO)).trim() : "";
}

async function textOf(tools: Tools, need: string): Promise<string> {
  return (await tools.read(need)).toString("utf8");
}

export function startChangelogStoreStation(): RunningStation {
  return defineStation("changelog-store", changelogStoreHandle(storeDeps()));
}
