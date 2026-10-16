// Mirrors one spec or ADR into the repo's Utopia knowledge base: builds its statement items and pushes them, four at a time, counting what Utopia said of each.

import {
  docStatementItems,
  type DocStatementsInput,
} from "../../domain/utopia/doc-statements.js";
import { tombstone, type PushItem } from "../../domain/utopia/statements.js";
import type { PushOutcome } from "../../outbound/utopia/utopia-client.js";

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

export interface TombstoneInput {
  repo: string;
  path: string;
  /** The statement ordinals the document was last pushed with; unknown ordinals leave their items standing. */
  ordinals?: number[];
}

const CONCURRENCY = 4;

export function mirrorDocument(
  deps: MirrorDeps,
  input: DocStatementsInput,
): Promise<MirrorOutcome> {
  return pushItems(deps, docStatementItems(input));
}

export function tombstoneDocument(
  deps: MirrorDeps,
  input: TombstoneInput,
): Promise<MirrorOutcome> {
  const statementIds = (input.ordinals ?? []).map(
    (ordinal) => `stmt:${input.path}#${String(ordinal).padStart(4, "0")}`,
  );

  return pushItems(
    deps,
    [`doc:${input.path}`, ...statementIds].map((externalId) =>
      tombstone(externalId),
    ),
  );
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
