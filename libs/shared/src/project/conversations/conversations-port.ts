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

/**
 * One node execution — the identity a conversation actually belongs to.
 *
 * A line was enough while every round was its own line. On a line whose rounds are
 * REVISITS (the merged planning line, FR6.21) they all share the id, so anything
 * addressing a round by line alone either excludes its own siblings or resumes the
 * wrong one. `iteration` omitted means "any execution on that line" — the shape a
 * one-round-per-line consumer still has.
 */
export interface ExecutionRef {
  assemblyLineId: string;
  iteration?: number;
}

/**
 * A PROJECTION of `pipeline.agent_conversations`, not the model: the six fields
 * a reader of a stored transcript needs. `keyKind`/`keyValue`/`nodeId` are the
 * write-side key the row was reserved under, and `iteration` belongs to the
 * dispatch that reserved it — none of them is anything a reader of the object
 * asks for. A port that wants six columns should say six columns.
 */
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
    /** Which execution on that line reserved it. */
    iteration?: number;
  }): Promise<void>;

  /** Attach the archive to a reserved id once the run uploads it. */
  attachArchive(
    conversationId: string,
    objectKey: string,
    bytes: number,
  ): Promise<boolean>;

  /**
   * The SAVED conversation a new run continues: the most recent one on the thread,
   * or — when `from` names one — that execution's specifically. Rows without
   * an archive are skipped: a reserved id whose run never uploaded cannot be resumed,
   * and offering it would send a pod after an object that does not exist.
   *
   * An explicit `from` that resolves to nothing returns null rather
   * than falling back to the newest. That is the REWIND contract: the author asked
   * for round 2, and quietly resuming round 4 instead would be indistinguishable
   * from a rewind that worked.
   */
  latestFor(
    thread: ConversationThread,
    opts?: {
      /** The run asking — never offered its own conversation back. */
      exclude?: ExecutionRef;
      /** Rewind: resume THIS execution's conversation, or none. */
      from?: ExecutionRef;
    },
  ): Promise<ConversationRecord | null>;

  /** One conversation by the id the pod was told to save as. */
  byConversationId(conversationId: string): Promise<ConversationRecord | null>;
}
