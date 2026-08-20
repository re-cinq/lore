import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `{team}.chunks` — one ingested content chunk. The table is created PER TEAM
 * schema (plus `org_shared`), so this model names no single schema: the caller
 * supplies it, which is what schema-per-team isolation means.
 *
 * DDL: `scripts/infra/setup-db.sh`. Two columns are excluded on purpose:
 * `embedding` is a pgvector `VECTOR(768)` no reader wants inline, and
 * `search_tsv` is a GENERATED column Postgres maintains — writing either from a
 * model would be wrong.
 */

export const ChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  contentType: z.string().nullable(),
  team: z.string().nullable(),
  repo: z.string().nullable(),
  filePath: z.string().nullable(),
  author: z.string().nullable(),
  ingestedAt: z.date().nullable(),
  metadata: z.record(z.unknown()).nullable(),
});

export type Chunk = z.infer<typeof ChunkSchema>;

export const CHUNK_COLUMNS = {
  id: "id",
  content: "content",
  contentType: "content_type",
  team: "team",
  repo: "repo",
  filePath: "file_path",
  author: "author",
  ingestedAt: "ingested_at",
  metadata: "metadata",
} as const satisfies ColumnMap<Chunk>;

/** Per-team: the schema is supplied by the caller, so this names the table only. */
export const CHUNK_TABLE = "chunks";
