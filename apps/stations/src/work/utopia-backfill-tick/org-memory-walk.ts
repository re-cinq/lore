// The org base's memory walk in the weekly backfill (specs/utopia-graph-mirror FR16): memories and episodes no onboarded repo owns live in `<org>/memory`, which no repo's backfill reaches, so the sweep walks it until it is drained.

import {
  UtopiaMemorySummarySchema,
  type UtopiaMemorySummary,
} from "@re-cinq/lore-shared/utopia/memory-summary.js";
import type { BackfillAnswer } from "./utopia-backfill-tick.js";

// A week's sweep carries 20 walks of 200 rows a kind; a base with more left finishes on the next sweep.
const MAX_WALKS = 20;

export interface OrgMemoryWalkDeps {
  walk: () => Promise<BackfillAnswer>;
  log: (line: string) => void;
}

export async function orgMemoryWalk(deps: OrgMemoryWalkDeps): Promise<string> {
  for (let walk = 1; walk <= MAX_WALKS; walk++) {
    const answer = await deps.walk();
    const summary = summaryOf(answer);

    if (!summary) {
      return `org memory: HTTP ${answer.status} ${answer.body.slice(0, 300)}`;
    }
    const failed = [...summary.memories.failed, ...summary.episodes.failed];

    if (failed.length > 0) {
      failed.forEach((failure) => deps.log(`org memory:   failed: ${failure}`));

      return `org memory: a push failed on walk ${walk}`;
    }

    if (drained(summary)) {
      return `org memory: drained in ${walk} walks`;
    }
  }

  return `org memory: not drained after ${MAX_WALKS} walks`;
}

function drained({ memories, episodes }: UtopiaMemorySummary): boolean {
  return memories.pass_complete && episodes.entries === 0;
}

function summaryOf(answer: BackfillAnswer): UtopiaMemorySummary | null {
  if (answer.status !== 200) {
    return null;
  }
  const parsed = UtopiaMemorySummarySchema.safeParse(safeJson(answer.body));

  return parsed.success ? parsed.data : null;
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
