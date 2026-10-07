// The daily digest's tick where the external floor walks it (specs/daily-digest FR14): decide which channels are due, then start one `daily-digest` run per channel on the floor. The floor's own schedules cannot do this part: a tick starts one run per line, and which channels are due is read from each repo's settings at the moment of the tick.
import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import { isOpen } from "@re-cinq/lore-shared/review/floor-review-runs.js";
import {
  DAILY_DIGEST_LINE,
  MAX_RUNS_PER_CHANNEL_DAY,
} from "@re-cinq/lore-shared/digest/contract.js";
import {
  digestRunArgs,
  dueChannelRuns,
  type ChannelRun,
  type DueDeps,
} from "@re-cinq/lore-shared/digest/due-channel-runs.js";

type Floor = ReturnType<typeof floorClient>;

export interface DigestTickDeps extends DueDeps {
  floor: {
    runs: Pick<Floor["runs"], "list">;
    lines: Pick<Floor["lines"], "start">;
  };
}

/** Starts the due channels' runs and says how many. One channel that cannot be started is logged and left for the next tick, never the whole tick. */
export async function digestTick(
  params: Readonly<Record<string, unknown>>,
  deps: DigestTickDeps,
): Promise<string> {
  const due = await dueChannelRuns({ ...params }, deps);
  const started = await Promise.all(
    due.map((run) =>
      startOnFloor(run, deps).catch((err: Error) => {
        console.error(`[digest] ${run.channel}: ${err.message}`);

        return false;
      }),
    ),
  );

  return `started ${started.filter(Boolean).length} of ${due.length} due channel(s)`;
}

/** One run per channel per scheduled slot of a local day: nothing starts while one is open, and a slot that already had its runs is not respawned all day. */
async function startOnFloor(
  run: ChannelRun,
  deps: DigestTickDeps,
): Promise<boolean> {
  const { runs, lines } = deps.floor;
  const slot = {
    repo: floorRepoOf(run.host.repo),
    line: DAILY_DIGEST_LINE,
    subject: `digest_key:${digestKey(run)}`,
  };
  const { items: earlier } = await runs.list(slot);

  if (earlier.some(isOpen) || earlier.length >= MAX_RUNS_PER_CHANNEL_DAY) {
    return false;
  }
  await startLine(lines, DAILY_DIGEST_LINE, {
    repo: slot.repo,
    startItems: startItems(digestKey(run), digestRunArgs(run, deps.now())),
  });

  return true;
}

/** The floor keys a run on the one argument its line marks as the subject; this is that value. */
function digestKey(run: ChannelRun): string {
  return `${run.channel}:${run.date}:${run.time}`;
}

/** Every run fact as a value the stations read back as needs. An empty voice is left out: the floor holds no empty value, and a missing one already means a plain tone. */
function startItems(
  key: string,
  args: ReturnType<typeof digestRunArgs>,
): Parameters<Floor["lines"]["start"]>[1]["startItems"] {
  const present = Object.entries({ digest_key: key, ...args }).filter(
    ([, value]) => value !== "",
  );

  return Object.fromEntries(
    present.map(([name, value]) => [name, valueItem(value)]),
  );
}
