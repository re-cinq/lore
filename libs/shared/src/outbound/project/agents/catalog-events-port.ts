// Read side of lore.catalog_events — append-only, multi-reader change log every cluster-agent tails to keep its CRDs in step; each reader keeps its own cursor, the log is never consumed.

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
  /** Full current catalog plus the max event id at read time as the cursor — serving cursor WITH snapshot makes bootstrap safe: a mid-snapshot event is at worst re-applied, never skipped. */
  snapshot(): Promise<{ entries: CatalogEntry[]; cursor: string }>;
}
