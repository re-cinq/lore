/**
 * The read side of `lore.catalog_events` — the append-only, multi-reader change
 * log every registered cluster-agent tails to keep its cluster's
 * AgentDefinition/Station CRDs in step with `lore.agent_definitions`.
 *
 * Appends happen inside PgAgentDefs' write statements (one CTE, so a definition
 * can never exist without its event); this port only reads. Fan-out, so
 * deliberately not the exclusive-claim event queue: every reader keeps its own
 * cursor (`pipeline.cluster_agents.catalog_cursor`) and the log is never
 * consumed. Ids are string-encoded bigints (the agent_run_events precedent).
 */

/** One catalog change: re-resolve `(name, projectId)` and apply what you find. */
export interface CatalogEvent {
  id: string;
  name: string;
  projectId: string | null;
  op: "upsert" | "delete";
}

/** A definition currently present — one entry of the full-resync snapshot. */
export interface CatalogEntry {
  name: string;
  projectId: string | null;
}

export interface CatalogEventsRepository {
  /** Events with `id > cursor`, ascending, capped at `limit`. */
  listSince(cursor: string, limit: number): Promise<CatalogEvent[]>;
  /**
   * The full current catalog — every `(name, projectId)` row — plus the max
   * event id at read time as the cursor a fresh reader stores. Serving the
   * cursor WITH the snapshot is what makes bootstrap safe: an event appended
   * mid-snapshot is at worst re-applied by the first tail, never skipped.
   */
  snapshot(): Promise<{ entries: CatalogEntry[]; cursor: string }>;
}
