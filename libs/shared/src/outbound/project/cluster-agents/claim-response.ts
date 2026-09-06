import type { LoreTaskSpec } from "../agents/k8s-port.js";

/** The `POST /api/cluster-agents/{id}/claim` 200 body — the claimed station run's identity plus its dispatch spec; shared so the lore-api route and the cluster-agent client type the same wire contract once. */
// eslint-disable-next-line lore/no-row-types-outside-models -- assembled cross-source (station_run identity + spec), and node_row_id deliberately renames the id column for the satellite reader
export interface ClaimResponse {
  station_run_id: string;
  /** String-encoded bigint — a JS number would silently lose precision past 2^53. */
  node_row_id: string;
  assembly_run_id: string;
  node_id: string;
  iteration: number;
  /** Null for a row enqueued without a CR name armed yet — the spec's own name is the fallback then. */
  agent_cr_name: string | null;
  spec: LoreTaskSpec;
}
