/** One row in `pipeline.context_core_history`: per-namespace record of a nightly context-core eval run. */
export interface ContextCoreRecord {
  version: string;
  namespace: string;
  evalScore: number;
  status: string;
}

/** The append surface for `pipeline.context_core_history` plus latest-production read. */
export interface ContextCorePort {
  /** The most recent `production` score for a namespace, or null if none yet. */
  latest(namespace: string): Promise<number | null>;
  /** Append one history row (status carries the run outcome). */
  insert(record: ContextCoreRecord): Promise<void>;
}
