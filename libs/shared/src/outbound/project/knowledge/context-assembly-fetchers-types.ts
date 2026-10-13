import type { PgPool } from "../../memory-store.js";
import type { FetchResult } from "./context-assembly-types.js";

/** Who an assembly reads as: whose memories a source searches, and whether the read may leave a trace. */
export interface SourceReader {
  agentId?: string;
  /** Read only: a source that records its retrievals must not record this one. */
  passive?: boolean;
}

/** Signature every named context source (repo/code/adrs/memories/graph/...) implements. */
export type SourceFetcher = (
  pool: PgPool,
  query: string,
  repo?: string,
  reader?: SourceReader,
) => Promise<FetchResult>;
