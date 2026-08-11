/**
 * pipeline.agent_conversations — the conversations a run can continue
 * (ai-agent-subsystem#188).
 *
 * A run's agent conversation is saved so a LATER run resumes it instead of being
 * re-briefed from scratch. Only the INDEX lives here; the archive bytes go through
 * the ArchivePort that already stores raw run streams, so nothing in Postgres grows
 * with transcript size.
 *
 * Threads are keyed by `(kind, value, nodeId)` and never by anything feature-shaped:
 * the assembly-line engine names a thread with `continues.key` = `line` / `task` /
 * `args.<name>` and knows nothing about features. Planning happens to key on
 * `args.feature_id`; another consumer could key on `args.customer_id` unchanged.
 */

/** How a thread's key was derived — mirrors `continues.key` in the definition. */
export type ThreadKind = "line" | "task" | "args";

export interface ConversationThread {
  kind: ThreadKind;
  /** An assembly-line id, a task id, or the value of the named arg. */
  value: string;
  nodeId: string;
}

export interface ConversationRecord {
  id: string;
  conversationId: string;
  /** Null until the run uploads — a row is reserved at dispatch so the id is known. */
  objectKey: string | null;
  bytes: number | null;
  assemblyLineId: string | null;
  createdAt: string;
}

export interface ConversationsPort {
  /** Reserve the id this run will save as, before it starts. */
  reserve(input: {
    thread: ConversationThread;
    conversationId: string;
    assemblyLineId: string | null;
  }): Promise<void>;

  /** Attach the archive to a reserved id once the run uploads it. */
  attachArchive(
    conversationId: string,
    objectKey: string,
    bytes: number,
  ): Promise<boolean>;

  /**
   * The SAVED conversation a new run continues: the most recent one on the thread,
   * or — when `fromAssemblyLineId` names one — that run's specifically. Rows without
   * an archive are skipped: a reserved id whose run never uploaded cannot be resumed,
   * and offering it would send a pod after an object that does not exist.
   *
   * An explicit `fromAssemblyLineId` that resolves to nothing returns null rather
   * than falling back to the newest. That is the REWIND contract: the author asked
   * for round 2, and quietly resuming round 4 instead would be indistinguishable
   * from a rewind that worked.
   */
  latestFor(
    thread: ConversationThread,
    opts?: { excludeAssemblyLineId?: string; fromAssemblyLineId?: string },
  ): Promise<ConversationRecord | null>;

  /** One conversation by the id the pod was told to save as. */
  byConversationId(conversationId: string): Promise<ConversationRecord | null>;
}
