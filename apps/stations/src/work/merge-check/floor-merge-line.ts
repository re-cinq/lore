// The merge line's run store when the external floor walks it (specs/external-floor FR10): the same three questions `startMergeLine` asks of Postgres, answered by the floor.
import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import { isOpen } from "@re-cinq/lore-shared/review/floor-review-runs.js";
import type { StartMergeLineDeps } from "./start-merge-line.js";

type Floor = ReturnType<typeof floorClient>;

export interface MergeLineFloor {
  runs: Pick<Floor["runs"], "list">;
  lines: Pick<Floor["lines"], "start">;
}

export const MERGE_LINE = "merge";

export function floorMergeLinePorts(floor: MergeLineFloor): StartMergeLineDeps {
  return {
    findOpenBySubject: async (repo, subjectKey) =>
      (await runsOf(floor, repo, subjectKey)).find(isOpen) ?? null,
    countBySubject: async (repo, subjectKey) =>
      (await runsOf(floor, repo, subjectKey)).length,
    start: async ({ repo, taskId }) =>
      (
        await startLine(floor.lines, MERGE_LINE, {
          repo: floorRepoOf(repo),
          startItems: { task_id: valueItem(taskId) },
        })
      ).run.id,
  };
}

/** Every merge run the floor holds for the task, open or settled. */
async function runsOf(floor: MergeLineFloor, repo: string, subjectKey: string) {
  const { items: runs } = await floor.runs.list({
    repo: floorRepoOf(repo),
    line: MERGE_LINE,
    subject: floorSubject(subjectKey),
  });

  return runs;
}

const LORE_SUBJECT_PREFIX = /^merge:/;

/** The floor keys a run `<argument>:<value>` for the argument its line marks as the subject, so Lore's `merge:<task>` is `task_id:<task>` there. */
function floorSubject(subjectKey: string): string {
  return subjectKey.replace(LORE_SUBJECT_PREFIX, "task_id:");
}
