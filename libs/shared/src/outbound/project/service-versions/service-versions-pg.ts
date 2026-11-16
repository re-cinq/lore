import {
  SERVICE_VERSION_COLUMNS,
  SERVICE_VERSION_TABLE,
  type ServiceVersion,
} from "../../../domain/models/service-version.js";
import { fromRow, selectList, type DbRow } from "../../../lib/row.js";
import type { PgPool } from "../../memory-store.js";
import type { ServiceVersionsPort } from "./service-versions-port.js";

/** Postgres-backed ServiceVersionsPort over `lore.service_versions`. */
export class PgServiceVersions implements ServiceVersionsPort {
  constructor(private readonly pool: PgPool) {}

  async record(version: ServiceVersion): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${SERVICE_VERSION_TABLE} (service, build, packages, started_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (service) DO UPDATE
          SET build = EXCLUDED.build, packages = EXCLUDED.packages, started_at = EXCLUDED.started_at`,
      [
        version.service,
        version.build,
        JSON.stringify(version.packages),
        version.startedAt,
      ],
    );
  }

  async list(): Promise<ServiceVersion[]> {
    const { rows } = await this.pool.query<DbRow>(
      `SELECT ${selectList(SERVICE_VERSION_COLUMNS)} FROM ${SERVICE_VERSION_TABLE} ORDER BY service`,
    );

    return rows.map((row) =>
      fromRow<ServiceVersion>(SERVICE_VERSION_COLUMNS, row),
    );
  }
}
