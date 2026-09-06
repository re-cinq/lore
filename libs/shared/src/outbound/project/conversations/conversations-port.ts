/** Conversation storage for run resumption, keyed by thread (line/task/args), not features. */

/** How a thread's key was derived — mirrors `continues.key` in the definition. */
export type ThreadKind = "line" | "task" | "args";

export interface ConversationThread {
  kind: ThreadKind;
  /** An assembly-line id, a task id, or the value of the named arg. */
  value: string;
  nodeId: string;
}

/** Node execution identity: line id + optional iteration for revisits (merged planning line, FR6.21). */
export interface ExecutionRef {
  assemblyLineId: string;
  iteration?: number;
}

/** Projection of pipeline.agent_conversations — six fields for transcript readers, not the write-side key. */
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

  /** Saved conversation most recent on thread, or rewind to specific execution; skips rows without archives. */
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
