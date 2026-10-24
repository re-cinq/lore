// Finding many tasks' runs on one line of a repository in a single walk of the floor's list, newest first.
import type { FloorClient, RunView } from "@re-cinq/floor-client";
import { floorRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { startValue } from "@re-cinq/lore-shared/review/floor-review-runs.js";

/** Which tasks' runs to find, on which line of which repository. */
export interface TaskRunsAsk {
  repo: string;
  line: string;
  taskIds: readonly string[];
}

type RunLister = Pick<FloorClient["runs"], "list">;

const PAGE_SIZE = 50;

/** How many pages the walk reads before giving up: 500 runs of one line. */
const MAX_PAGES = 10;

/** Each wanted task's newest run, walking the line's list page by page until every task is found or the list ends. */
export async function newestRunPerTask(
  runs: RunLister,
  { repo, line, taskIds }: TaskRunsAsk,
): Promise<Map<string, RunView>> {
  const wanted = new Set(taskIds);
  const found = new Map<string, RunView>();
  let cursor: string | null | undefined;

  for (let page = 0; page < MAX_PAGES && found.size < wanted.size; page++) {
    const listed = await runs.list(
      { repo: floorRepoOf(repo), line },
      { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    );

    keepNewest(listed.items, wanted, found);
    cursor = listed.nextCursor;

    if (!cursor) {
      break;
    }
  }

  return found;
}

/** The first run of each wanted task in a newest-first page is its newest; a later page cannot replace it. */
function keepNewest(
  runs: readonly RunView[],
  wanted: ReadonlySet<string>,
  found: Map<string, RunView>,
): void {
  for (const run of runs) {
    const taskId = startValue(run, "task_id");

    if (taskId && wanted.has(taskId) && !found.has(taskId)) {
      found.set(taskId, run);
    }
  }
}
