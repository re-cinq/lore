// The push every Utopia mirror kind shares: items pushed four at a time, counting what Utopia said of each.

import type { PushItem } from "../../domain/utopia/statements.js";
import type { PushOutcome } from "../../outbound/utopia/utopia-client.js";

export const CONCURRENCY = 4;

export interface MirrorDeps {
  push(pushed: PushItem): Promise<PushOutcome>;
}

export interface MirrorOutcome {
  items: number;
  created: number;
  updated: number;
  unchanged: number;
  /** `<external id>: <message>` for every push that threw; the rest still landed. */
  failed: string[];
}

/** Pushes the items four at a time, counting what Utopia said of each; an item whose push threw is named under `failed` and the rest still land. */
export async function pushItems(
  deps: MirrorDeps,
  queue: PushItem[],
): Promise<MirrorOutcome> {
  const outcome: MirrorOutcome = {
    items: queue.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: [],
  };
  const pending = [...queue];
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      await pushOne(deps, next, outcome);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return outcome;
}

/** Why a document did not land whole, named by its first failed item; null when every item landed. */
export function mirrorFailure(outcome: MirrorOutcome): string | null {
  const { failed } = outcome;

  return failed.length === 0
    ? null
    : `${failed.length} of ${outcome.items} items failed: ${failed[0]}`;
}

async function pushOne(
  deps: MirrorDeps,
  pushed: PushItem,
  outcome: MirrorOutcome,
): Promise<void> {
  try {
    const { action } = await deps.push(pushed);

    if (action !== "marked_missing") {
      outcome[action] += 1;
    }
  } catch (error) {
    outcome.failed.push(
      `${pushed.externalId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
