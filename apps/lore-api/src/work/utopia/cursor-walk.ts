// The loop every cursor-driven Utopia walk shares: entries pushed in order, the cursor moved past each one that landed whole, the first that did not ending the walk, and one repo's walks run one after the other.

import { errorMessage } from "@re-cinq/lore-shared";
import {
  mirrorFailure,
  type MirrorOutcome,
} from "@re-cinq/lore-shared/utopia/push-items.js";

export interface CursorWalk<T> {
  /** The cursor once `entry` has landed. */
  cursorOf(entry: T): string;
  /** How `failed` names the entry the walk stopped at. */
  labelOf(entry: T): string;
  mirror(entry: T): Promise<MirrorOutcome>;
  writeCursor(cursor: string): Promise<void>;
}

export interface WalkTally {
  /** The cursor after the last entry that landed; null when none did. */
  to: string | null;
  landed: number;
  created: number;
  updated: number;
  unchanged: number;
  /** `<label>: <message>` for the entry the walk stopped at; the next walk retries it. */
  failed: string[];
}

const NOTHING_LANDED: WalkTally = {
  to: null,
  landed: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
};

export async function walkInOrder<T>(
  entries: T[],
  walk: CursorWalk<T>,
): Promise<WalkTally> {
  let tally = NOTHING_LANDED;

  for (const entry of entries) {
    const result = await mirrorOne(walk, entry);

    if (result.failure !== null) {
      return {
        ...tally,
        failed: [`${walk.labelOf(entry)}: ${result.failure}`],
      };
    }
    const cursor = walk.cursorOf(entry);

    await walk.writeCursor(cursor);
    tally = advanced(tally, cursor, result);
  }

  return tally;
}

type ItemResult = Pick<MirrorOutcome, "created" | "updated" | "unchanged"> & {
  failure: string | null;
};

/** A push that threw and a push with a failed item are the same: the entry did not land whole. */
async function mirrorOne<T>(
  walk: CursorWalk<T>,
  entry: T,
): Promise<ItemResult> {
  try {
    const outcome = await walk.mirror(entry);

    return { ...outcome, failure: mirrorFailure(outcome) };
  } catch (error) {
    return {
      created: 0,
      updated: 0,
      unchanged: 0,
      failure: errorMessage(error),
    };
  }
}

function advanced(
  tally: WalkTally,
  cursor: string,
  result: ItemResult,
): WalkTally {
  return {
    ...tally,
    to: cursor,
    landed: tally.landed + 1,
    created: tally.created + result.created,
    updated: tally.updated + result.updated,
    unchanged: tally.unchanged + result.unchanged,
  };
}

const walking = new Map<string, Promise<unknown>>();

/** Two overlapping walks of one repo would each read the same entries and the later to finish would move a cursor back; so one waits for the other, whatever the other's outcome. Every walk kind shares the queue, so a repo has one walk in flight. */
export function queuedPerRepo<T>(
  repo: string,
  start: () => Promise<T>,
): Promise<T> {
  const key = repo.toLowerCase();
  const ahead = walking.get(key) ?? Promise.resolve();
  const run = ahead.then(start, start);

  const release = () => {
    if (walking.get(key) === run) {
      walking.delete(key);
    }
  };

  walking.set(key, run);
  void run.then(release, release);

  return run;
}
