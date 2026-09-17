import type { PgPool } from "../../memory-store.js";
import type {
  CatalogEntry,
  CatalogEvent,
  CatalogEventsRepository,
} from "./catalog-events-port.js";

/** Postgres-backed {@link CatalogEventsRepository} over `lore.catalog_events`. */

interface EventRow {
  id: string;
  name: string;
  project_id: string | null;
  op: "upsert" | "delete";
}

// Org-level upserts fan out to every project row of that name via a UNION.
const LIST_SQL = `WITH raw AS (
   SELECT id::text, name, project_id, op
     FROM lore.catalog_events
    WHERE id > $1::bigint
    ORDER BY id ASC
    LIMIT $2
 ),
 expanded AS (
   SELECT id, name, project_id, op FROM raw
   UNION ALL
   SELECT r.id, r.name, d.project_id, r.op
     FROM raw r
     JOIN lore.agent_definitions d
       ON d.name = r.name AND d.project_id IS NOT NULL
    WHERE r.project_id IS NULL AND r.op = 'upsert'
 )
 SELECT id, name, project_id, op FROM expanded ORDER BY id ASC`;

function toEvent(r: EventRow): CatalogEvent {
  return { id: r.id, name: r.name, projectId: r.project_id, op: r.op };
}

export class PgCatalogEvents implements CatalogEventsRepository {
  constructor(private readonly pool: PgPool) {}

  async listSince(cursor: string, limit: number): Promise<CatalogEvent[]> {
    const { rows } = await this.pool.query<EventRow>(LIST_SQL, [cursor, limit]);
    return (rows as EventRow[]).map(toEvent);
  }

  async snapshot(): Promise<{ entries: CatalogEntry[]; cursor: string }> {
    // Read cursor before snapshot; event appended between is already in snapshot (re-applies, never skips).
    const { rows: cursorRows } = await this.pool.query<{ max: string | null }>(
      `SELECT MAX(id)::text AS max FROM lore.catalog_events`,
    );
    const { rows } = await this.pool.query<{
      name: string;
      project_id: string | null;
    }>(
      `SELECT name, project_id FROM lore.agent_definitions ORDER BY name, project_id`,
    );

    return {
      entries: rows.map((r) => ({ name: r.name, projectId: r.project_id })),
      cursor: (cursorRows[0] as { max: string | null }).max ?? "0",
    };
  }
}
