import type { PgPool } from "../../memory-store.js";
import { CATALOG_APPLY_STATUS_COLUMNS } from "../../models/catalog-apply-status.js";
import type { CatalogApplyStatusSchema } from "../../models/catalog-apply-status.js";
import type { WireOf } from "../../lib/wire-schema.js";
import type {
  CatalogApplyReport,
  CatalogApplyStatus,
  CatalogStatusRepository,
} from "./catalog-status-port.js";

/** Postgres-backed {@link CatalogStatusRepository} over `lore.catalog_apply_status`. */

const NIL_UUID = "'00000000-0000-0000-0000-000000000000'::uuid";

/** The row's own columns (via the model), plus `cluster_name` joined in from `pipeline.cluster_agents`. */
type StatusRow = WireOf<
  typeof CatalogApplyStatusSchema.shape,
  typeof CATALOG_APPLY_STATUS_COLUMNS
> & { cluster_name: string };

export class PgCatalogStatus implements CatalogStatusRepository {
  constructor(private readonly pool: PgPool) {}

  async record(
    clusterAgentId: string,
    reports: readonly CatalogApplyReport[],
  ): Promise<void> {
    if (reports.length === 0) {
      return;
    }

    // One statement for the whole batch — UNNEST keeps it a single parameterised call regardless of size.
    await this.pool.query(
      `INSERT INTO lore.catalog_apply_status
         (cluster_agent_id, name, project_id, state, reason)
       SELECT $1, u.name, u.project_id::uuid, u.state, u.reason
         FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[])
              AS u(name, project_id, state, reason)
       ON CONFLICT (cluster_agent_id, name, (COALESCE(project_id, ${NIL_UUID})))
       DO UPDATE SET
         state = EXCLUDED.state,
         reason = EXCLUDED.reason,
         updated_at = now()`,
      [
        clusterAgentId,
        reports.map((r) => r.name),
        reports.map((r) => r.projectId),
        reports.map((r) => r.state),
        reports.map((r) => r.reason),
      ],
    );
  }

  async list(): Promise<CatalogApplyStatus[]> {
    const { rows } = await this.pool.query<StatusRow>(
      `SELECT s.cluster_agent_id::text, c.name AS cluster_name, s.name,
              s.project_id::text, s.state, s.reason, s.updated_at
         FROM lore.catalog_apply_status s
         JOIN pipeline.cluster_agents c ON c.id = s.cluster_agent_id
        ORDER BY s.name, c.name`,
    );

    return (rows as StatusRow[]).map((r) => ({
      clusterAgentId: r.cluster_agent_id,
      clusterName: r.cluster_name,
      name: r.name,
      projectId: r.project_id,
      state: r.state,
      reason: r.reason,
      updatedAt: r.updated_at,
    }));
  }
}
