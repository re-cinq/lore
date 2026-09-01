/**
 * What each cluster DID with each catalog entry — the question the ack cursor
 * cannot answer.
 *
 * The cursor says how far a cluster has read; this says whether the entry it
 * read was applied, refused (and why), skipped as another writer's, or deleted.
 * Without it a refusal lives only in one pod's stdout and dies with the pod:
 * on 2026-09-01 a cluster refused an entry for two hours with no record
 * anywhere, and a satellite refusing every recipe overnight would leave
 * nothing behind at all.
 *
 * CURRENT state per (cluster, definition), never a history — a later success
 * must erase the refusal it replaces, because a page still showing a fixed
 * problem is worse than one showing nothing.
 */

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
