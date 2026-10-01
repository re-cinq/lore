// A floor run's agent events so far, read off the run's own journal: the same frames the live relay sends, numbered the same way, so the history a page folds first and the stream it opens next share one cursor.
import type { FloorClient } from "@re-cinq/floor-client";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import { recordToAgentEvents } from "./floor-records.js";
import { floorCursorOf } from "./floor-run-mapping.js";

export type WatchRun = FloorClient["runs"]["watch"];

/** The events after the cursor, up to where the journal stands now. The watch is left the moment it has caught up — what comes later is the live channel's to deliver — and a run the floor refuses answers nothing. */
export async function floorRunHistory(
  watch: WatchRun,
  runId: string,
  after: string | undefined,
): Promise<AgentRunEvent[]> {
  const journal = watch(runId, { after: floorCursorOf(after) });

  try {
    return await eventsUntilCaughtUp(journal, runId);
  } finally {
    // A watch is a socket on the floor: it is let go however the read ended.
    journal.stop();
  }
}

async function eventsUntilCaughtUp(
  journal: ReturnType<WatchRun>,
  runId: string,
): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];

  for await (const frame of journal) {
    if (frame.type === "caught_up") {
      break;
    }

    if (frame.type === "record") {
      events.push(...recordToAgentEvents(frame.record, { ...frame, runId }));
    }
  }

  return events;
}
