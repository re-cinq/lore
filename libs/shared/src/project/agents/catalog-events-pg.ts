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

export class PgCatalogEvents implements CatalogEventsRepository {
  constructor(private readonly pool: PgPool) {}

  async listSince(cursor: string, limit: number): Promise<CatalogEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT id::text, name, project_id, op
         FROM lore.catalog_events
        WHERE id > $1::bigint
        ORDER BY id ASC
        LIMIT $2`,
      [cursor, limit],
    );

    return (rows as EventRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      projectId: r.project_id,
      op: r.op,
    }));
  }

  async snapshot(): Promise<{ entries: CatalogEntry[]; cursor: string }> {
    // Cursor first, snapshot second: an event appended between the two reads
    // is BELOW the stored cursor and its row is already in the snapshot, so
    // the reader's first tail at worst re-applies it — never skips it.
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
