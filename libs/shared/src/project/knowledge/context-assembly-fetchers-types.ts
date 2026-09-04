import type { PgPool } from "../../memory-store.js";
import type { FetchResult } from "./context-assembly-types.js";

/** Signature every named context source (repo/code/adrs/memories/graph/...) implements. */
export type SourceFetcher = (
  pool: PgPool,
  query: string,
  repo?: string,
  agentId?: string,
) => Promise<FetchResult>;
