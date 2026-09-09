// What each cluster DID with each catalog entry (applied/refused/skipped/deleted); latest verdict erases prior refusal.

export type CatalogApplyState = "applied" | "refused" | "skipped" | "deleted";

/** One cluster's verdict on one definition. */
export interface CatalogApplyReport {
  name: string;
  projectId: string | null;
  state: CatalogApplyState;
  /** Why, for refused and skipped; null when the entry simply applied. */
  reason: string | null;
}

/** A verdict as read back, carrying the cluster that reached it. */
export interface CatalogApplyStatus extends CatalogApplyReport {
  clusterAgentId: string;
  clusterName: string;
  updatedAt: Date;
}

export interface CatalogStatusRepository {
  /** Upsert one batch of verdicts from one cluster, replacing what it said before. */
  record(
    clusterAgentId: string,
    reports: readonly CatalogApplyReport[],
  ): Promise<void>;
  /** Every cluster's current verdict on every definition, for the /agents read. */
  list(): Promise<CatalogApplyStatus[]>;
}
