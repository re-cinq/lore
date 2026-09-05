import { enforceTrue } from "../../lib/enforce.js";

/** One stored chunk row in InMemoryChunks — not the Chunk model: carries schema (the double must track it, having no schemas) and the formatted embedding string; drops author (unused by the double). */
export interface ChunkRow {
  id: string;
  schema: string;
  content: string;
  contentType: string;
  /** Nullable for legacy rows ingested before team tracking existed; org_shared reads filter these out. */
  team: string | null;
  repo: string;
  filePath: string;
  metadata: Record<string, unknown>;
  embedding: string | null;
  /** Seedable ISO timestamp for the staleChunkCount age check (defaults to now). */
  ingestedAt: string;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

export function enforceSchema(schema: string): void {
  enforceTrue(
    SCHEMA_RE.test(schema),
    Error,
    `Invalid schema name: ${JSON.stringify(schema)}`,
  );
}
