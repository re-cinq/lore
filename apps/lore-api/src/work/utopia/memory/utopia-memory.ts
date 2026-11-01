// Mirrors a base's memories and episodes into Utopia (specs/utopia-graph-mirror FR16), each row pushed to the base's `memories` or `episodes` api source and the cursor moved past it. Episodes never change once inserted, so one walk in insert order holds them all. Memories change in place, and the stations' expiry and eviction cannot push, so memories are walked in repeating passes by id: a pass re-sends every memory, an unchanged one answers unchanged, and a changed or dead one lands as its new document or its tombstone.

import type { Pool } from "pg";
import type { IngestDocument } from "@re-cinq/lore-shared/utopia/memory-documents.js";
import {
  utopiaClientFrom,
  type DocumentPushOutcome,
  type UtopiaEnv,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/push-items.js";
import type { UtopiaMemorySummary } from "@re-cinq/lore-shared/utopia/memory-summary.js";
import type { UtopiaTrackerSummary } from "@re-cinq/lore-shared/utopia/tracker-summary.js";
import {
  saveMemoryCursor,
  type MemoryBase,
  type MemoryKind,
} from "../../../outbound/utopia/memory-sources.js";
import {
  episodeRowsAfter,
  memoryRowsAfter,
  type CursoredDocument,
} from "../../../outbound/memory-rows.js";
import {
  queuedPerRepo,
  walkInOrder,
} from "@re-cinq/lore-shared/utopia/cursor-walk.js";
import { memorySourceOf, type MemorySource } from "./utopia-memory-base.js";

export type { MemoryKind, CursoredDocument };

export interface MemoryWalkDeps {
  /** The repo, or the org's memory base, whose rows the walk reads; one walk of a base runs at a time. */
  base: string;
  rows(
    kind: MemoryKind,
    after: string | null,
    limit: number,
  ): Promise<CursoredDocument[]>;
  cursor: {
    read(kind: MemoryKind): Promise<string | null>;
    write(kind: MemoryKind, cursor: string | null): Promise<void>;
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
    memories: await walkMemoryPass(deps),
    episodes: (await walkKind(deps, "episodes")).summary,
  }));
}

/** A walk that read fewer rows than it may, with none failed, reached the end of the pass: the cursor goes back to null, so the next walk starts the next pass from the first memory. */
async function walkMemoryPass(
  deps: MemoryWalkDeps,
): Promise<UtopiaMemorySummary["memories"]> {
  const { summary, read } = await walkKind(deps, "memories");
  const passComplete =
    summary.failed.length === 0 && read < MAX_MEMORY_ROWS_PER_RUN;

  if (passComplete) {
    await deps.cursor.write("memories", null);
  }

  return { ...summary, pass_complete: passComplete };
}

async function walkKind(
  deps: MemoryWalkDeps,
  kind: MemoryKind,
): Promise<{ summary: UtopiaTrackerSummary; read: number }> {
  const from = await deps.cursor.read(kind);
  const rows = await deps.rows(kind, from, MAX_MEMORY_ROWS_PER_RUN);
  const { landed, ...tally } = await walkInOrder(rows, {
    cursorOf: (row) => row.cursor,
    labelOf: (row) => row.document.external_id,
    mirror: async (row) =>
      outcomeOf((await deps.push(kind, row.document)).action),
    writeCursor: (cursor) => deps.cursor.write(kind, cursor),
  });

  return { summary: { from, ...tally, entries: landed }, read: rows.length };
}

const READERS = { memories: memoryRowsAfter, episodes: episodeRowsAfter };

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
      write: (kind, cursor) => saveMemoryCursor(pool, base.name, kind, cursor),
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
