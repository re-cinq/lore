// Mirrors a base's memories and episodes into Utopia (specs/utopia-graph-mirror FR16): the rows whose mirror sequence number is above the cursor, lowest first, each pushed to the base's `memories` or `episodes` api source and the cursor moved past it. Every write, delete, expiry and eviction moves a row's sequence number, so the walk carries what the stations' sweeps changed as well as what lore-api wrote.

import type { Pool } from "pg";
import type { IngestDocument } from "@re-cinq/lore-shared/utopia/memory-documents.js";
import {
  utopiaClientFrom,
  type DocumentPushOutcome,
  type UtopiaEnv,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import type {
  UtopiaMemorySummary,
  UtopiaTrackerSummary,
} from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import {
  saveMemoryCursor,
  type MemoryBase,
  type MemoryKind,
} from "../../outbound/utopia-memory-sources.js";
import {
  episodeRowsAbove,
  memoryRowsAbove,
  type SequencedDocument,
} from "../../outbound/memory-rows.js";
import { queuedPerRepo, walkInOrder } from "./cursor-walk.js";
import { memorySourceOf, type MemorySource } from "./utopia-memory-base.js";

export type { MemoryKind, SequencedDocument };

export interface MemoryWalkDeps {
  /** The repo, or the org's memory base, whose rows the walk reads; one walk of a base runs at a time. */
  base: string;
  rows(
    kind: MemoryKind,
    after: string | null,
    limit: number,
  ): Promise<SequencedDocument[]>;
  cursor: {
    read(kind: MemoryKind): Promise<string | null>;
    write(kind: MemoryKind, seq: string): Promise<void>;
  };
  push(
    kind: MemoryKind,
    document: IngestDocument,
  ): Promise<DocumentPushOutcome>;
}

/** Each kind's walk pushes this many rows at most, for the reason the tracker walk does: every episode costs Utopia a model extraction. */
export const MAX_MEMORY_ROWS_PER_RUN = 200;

export function mirrorMemoryBacklog(
  deps: MemoryWalkDeps,
): Promise<UtopiaMemorySummary> {
  return queuedPerRepo(deps.base, async () => ({
    memories: await walkKind(deps, "memories"),
    episodes: await walkKind(deps, "episodes"),
  }));
}

async function walkKind(
  deps: MemoryWalkDeps,
  kind: MemoryKind,
): Promise<UtopiaTrackerSummary> {
  const from = await deps.cursor.read(kind);
  const rows = await deps.rows(kind, from, MAX_MEMORY_ROWS_PER_RUN);
  const { landed, ...tally } = await walkInOrder(rows, {
    cursorOf: (row) => row.seq,
    labelOf: (row) => row.document.external_id,
    mirror: async (row) =>
      outcomeOf((await deps.push(kind, row.document)).action),
    writeCursor: (seq) => deps.cursor.write(kind, seq),
  });

  return { from, ...tally, entries: landed };
}

const READERS = { memories: memoryRowsAbove, episodes: episodeRowsAbove };

/** The base's rows, its cursors and its sources. Each kind's source is found once per walk, before its cursor is read: a source created anew starts its walk from the first row. A base whose source cannot be had reads from the start and fails its first push with the reason. */
export function memoryWalkDepsFor(
  pool: Pool,
  base: MemoryBase,
  env: UtopiaEnv = process.env,
): MemoryWalkDeps {
  const sourceOf = sourcesOnce((kind) => memorySourceOf(pool, base, kind, env));

  return {
    base: base.name,
    rows: (kind, after, limit) => READERS[kind](pool, base, { after, limit }),
    cursor: {
      read: async (kind) =>
        (await sourceOf(kind).catch(() => null))?.cursor ?? null,
      write: (kind, seq) => saveMemoryCursor(pool, base.name, kind, seq),
    },
    push: async (kind, document) =>
      utopiaClientFrom(env).pushDocument(await sourceOf(kind), document),
  };
}

function sourcesOnce(
  find: (kind: MemoryKind) => Promise<MemorySource>,
): (kind: MemoryKind) => Promise<MemorySource> {
  const found = new Map<MemoryKind, Promise<MemorySource>>();

  return (kind) => {
    const source = found.get(kind) ?? find(kind);

    found.set(kind, source);

    return source;
  };
}

const COUNTED: Record<
  DocumentPushOutcome["action"],
  "created" | "updated" | "unchanged" | null
> = {
  created: "created",
  updated: "updated",
  moved: "updated",
  unchanged: "unchanged",
  duplicate: "unchanged",
  marked_missing: null,
};

/** One document is one item; a tombstone lands without a count, as a statement tombstone does. */
function outcomeOf(action: DocumentPushOutcome["action"]): MirrorOutcome {
  const counted = COUNTED[action];
  const outcome = {
    items: 1,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: [],
  };

  return counted ? { ...outcome, [counted]: 1 } : outcome;
}
