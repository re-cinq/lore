// The push every Utopia mirror kind shares: items pushed four at a time, counting what Utopia said of each.

import { enforceTrue } from "../../lib/enforce.js";
import type { PushItem } from "../../domain/utopia/statements.js";
import type { IngestDocument } from "../../domain/utopia/memory/memory-documents.js";
import type {
  DocumentPushOutcome,
  PushAction,
  PushOutcome,
} from "../../outbound/utopia/utopia-client.js";

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

export interface DocumentMirrorDeps {
  push(document: IngestDocument): Promise<DocumentPushOutcome>;
}

/** Pushes the items four at a time, counting what Utopia said of each; an item whose push threw is named under `failed` and the rest still land. */
export function pushItems(
  deps: MirrorDeps,
  queue: PushItem[],
): Promise<MirrorOutcome> {
  return pushAll(queue, {
    idOf: (pushed) => pushed.externalId,
    push: deps.push,
  });
}

/** {@link pushItems} for whole text documents, the way an `api` source takes them. */
export function pushDocuments(
  deps: DocumentMirrorDeps,
  queue: IngestDocument[],
): Promise<MirrorOutcome> {
  return pushAll(queue, {
    idOf: (document) => document.external_id,
    push: deps.push,
  });
}

/** Two outcomes as one, for a document pushed to two sources. */
export function combineOutcomes(
  first: MirrorOutcome,
  second: MirrorOutcome,
): MirrorOutcome {
  return {
    items: first.items + second.items,
    created: first.created + second.created,
    updated: first.updated + second.updated,
    unchanged: first.unchanged + second.unchanged,
    failed: [...first.failed, ...second.failed],
  };
}

async function pushAll<Payload>(
  queue: Payload[],
  target: PushTarget<Payload>,
): Promise<MirrorOutcome> {
  const outcome = emptyOutcome(queue.length);
  const pending = [...queue];
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      await pushOne(next, target, outcome);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return outcome;
}

interface PushTarget<Payload> {
  idOf: (payload: Payload) => string;
  push: (payload: Payload) => Promise<{ action: PushAction | "moved" }>;
}

function emptyOutcome(count: number): MirrorOutcome {
  return { items: count, created: 0, updated: 0, unchanged: 0, failed: [] };
}

/** Why a document did not land whole, named by its first failed item; null when every item landed. */
export function mirrorFailure(outcome: MirrorOutcome): string | null {
  const { failed } = outcome;

  return failed.length === 0
    ? null
    : `${failed.length} of ${outcome.items} items failed: ${failed[0]}`;
}

async function pushOne<Payload>(
  payload: Payload,
  target: PushTarget<Payload>,
  outcome: MirrorOutcome,
): Promise<void> {
  try {
    const counted = landed((await target.push(payload)).action);

    if (counted) {
      outcome[counted] += 1;
    }
  } catch (error) {
    outcome.failed.push(
      `${target.idOf(payload)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A `moved` document is the content of another identity arriving under this one: an update. */
function landed(
  action: PushAction | "moved",
): "created" | "updated" | "unchanged" | null {
  enforceTrue(
    action !== "duplicate",
    Error,
    "duplicate, another document in the knowledge base holds the same content",
  );

  if (action === "marked_missing") {
    return null;
  }

  return action === "moved" ? "updated" : action;
}
