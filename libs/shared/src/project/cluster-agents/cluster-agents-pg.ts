import { enforceTrue } from "../../lib/enforce.js";
import { selectList, fromRow, type DbRow } from "../../lib/row.js";
import {
  CLUSTER_AGENT_COLUMNS,
  CLUSTER_AGENT_TABLE,
  type ClusterAgent,
} from "../../models/cluster-agent.js";
import type { PgPool } from "../../memory-store.js";
import type {
  ClusterAgentsRepository,
  RegisterClusterAgentInput,
} from "./cluster-agents-port.js";

/**
 * Postgres-backed {@link ClusterAgentsRepository} over
 * `pipeline.cluster_agents`. `heartbeat` and `markOffline` both flip `status`
 * so the reaper's offline sweep and the agent's own revival cannot disagree
 * about what `active` means.
 */
export class PgClusterAgents implements ClusterAgentsRepository {
  constructor(private readonly pool: PgPool) {}

  private async selectOne(
    where: string,
    params: unknown[],
  ): Promise<ClusterAgent | null> {
    const { rows } = await this.pool.query<DbRow>(
      `SELECT ${selectList(CLUSTER_AGENT_COLUMNS)}
         FROM ${CLUSTER_AGENT_TABLE}
        WHERE ${where}`,
      params,
    );

    return rows[0]
      ? fromRow<ClusterAgent>(CLUSTER_AGENT_COLUMNS, rows[0])
      : null;
  }

  async findByName(name: string): Promise<ClusterAgent | null> {
    return this.selectOne("name = $1", [name]);
  }

  async findById(id: string): Promise<ClusterAgent | null> {
    return this.selectOne("id = $1", [id]);
  }

  async findByTokenHash(tokenHash: string): Promise<ClusterAgent | null> {
    return this.selectOne("token_hash = $1", [tokenHash]);
  }

  async create(input: RegisterClusterAgentInput): Promise<ClusterAgent | null> {
    // ON CONFLICT DO NOTHING: two first-boots of the same name race between
    // the route's findByName and this insert; the loser gets null, not a 23505.
    const { rows } = await this.pool.query<DbRow>(
      `INSERT INTO ${CLUSTER_AGENT_TABLE} (name, tags, token_hash, cluster_info)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO NOTHING
       RETURNING ${selectList(CLUSTER_AGENT_COLUMNS)}`,
      [input.name, input.tags, input.tokenHash, input.clusterInfo],
    );

    return rows[0]
      ? fromRow<ClusterAgent>(CLUSTER_AGENT_COLUMNS, rows[0])
      : null;
  }

  async rotate(
    id: string,
    input: RegisterClusterAgentInput,
  ): Promise<ClusterAgent> {
    const { rows } = await this.pool.query<DbRow>(
      `UPDATE ${CLUSTER_AGENT_TABLE}
          SET tags = $2, token_hash = $3, cluster_info = $4,
              last_seen_at = now(), status = 'active'
        WHERE id = $1
       RETURNING ${selectList(CLUSTER_AGENT_COLUMNS)}`,
      [id, input.tags, input.tokenHash, input.clusterInfo],
    );

    enforceTrue(rows[0], Error, `cluster agent ${id} not found`);

    return fromRow<ClusterAgent>(CLUSTER_AGENT_COLUMNS, rows[0]);
  }

  async heartbeat(id: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE ${CLUSTER_AGENT_TABLE}
          SET last_seen_at = $2, status = 'active'
        WHERE id = $1`,
      [id, at],
    );
  }

  async markOffline(cutoff: Date): Promise<ClusterAgent[]> {
    const { rows } = await this.pool.query<DbRow>(
      `UPDATE ${CLUSTER_AGENT_TABLE}
          SET status = 'offline'
        WHERE status = 'active' AND last_seen_at < $1
       RETURNING ${selectList(CLUSTER_AGENT_COLUMNS)}`,
      [cutoff],
    );

    return rows.map((row) => fromRow<ClusterAgent>(CLUSTER_AGENT_COLUMNS, row));
  }

  async list(): Promise<ClusterAgent[]> {
    const { rows } = await this.pool.query<DbRow>(
      `SELECT ${selectList(CLUSTER_AGENT_COLUMNS)}
         FROM ${CLUSTER_AGENT_TABLE}
        ORDER BY name`,
    );

    return rows.map((row) => fromRow<ClusterAgent>(CLUSTER_AGENT_COLUMNS, row));
  }
}
