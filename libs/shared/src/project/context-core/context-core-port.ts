/**
 * One row in `pipeline.context_core_history` — the per-namespace record of a
 * nightly context-core eval run. The context-core builder writes one of these
 * on every namespace it evaluates (promoted / rejected-regression / no-change)
 * and reads back the latest `production` row to compute the score delta.
 */
export interface ContextCoreRecord {
  version: string;
  namespace: string;
  evalScore: number;
  status: string;
}

/**
 * The append surface for `pipeline.context_core_history`, plus the
 * latest-production read the builder uses as its baseline. Carved out of the
 * Floor's context-core-builder so the score history reaches the table through
 * the Project facade rather than a bespoke `query()`.
 */
export interface ContextCorePort {
  /** The most recent `production` score for a namespace, or null if none yet. */
  latest(namespace: string): Promise<number | null>;
  /** Append one history row (status carries the run outcome). */
  insert(record: ContextCoreRecord): Promise<void>;
}
