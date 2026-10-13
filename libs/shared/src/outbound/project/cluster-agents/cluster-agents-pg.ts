import type { Pool } from "pg";

export interface ClusterInfo {
  served_models?: string[];
  [key: string]: unknown;
}

export interface ClusterAgent {
  id: string;
  status: "active" | "offline";
  paused?: boolean;
  cluster_info: ClusterInfo | null;
}

export const PgClusterAgents = function (pool: Pool) {
  return {
    async list(): Promise<ClusterAgent[]> {
      const res = await pool.query(
        `SELECT id, status, cluster_info FROM pipeline.cluster_agents`,
      );

      return res.rows;
    },
  };
};
