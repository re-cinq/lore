import type {
  ConversationRecord,
  ConversationThread,
  ConversationsPort,
  ExecutionRef,
} from "./conversations-port.js";

const sameThread = (a: ConversationThread, b: ConversationThread): boolean =>
  a.kind === b.kind && a.value === b.value && a.nodeId === b.nodeId;

/** Does this row belong to the named execution?
 *
 *  An `iteration`-less REF matches any execution on the line — the caller holds only
 *  a line. An `iteration`-less ROW matches any ref for its line: it predates the
 *  column, when a line had exactly one execution. Both directions must stay loose,
 *  or a legacy row is neither excludable nor addressable. */
const isExecution = (
  row: { assemblyLineId: string | null; iteration: number | null },
  ref: ExecutionRef,
): boolean =>
  row.assemblyLineId === ref.assemblyLineId &&
  (ref.iteration === undefined ||
    row.iteration === null ||
    row.iteration === ref.iteration);

/** In-memory ConversationsPort — the behavioural spec the Pg adapter must match. */
export class InMemoryConversations implements ConversationsPort {
  readonly rows: (ConversationRecord & {
    thread: ConversationThread;
    iteration: number | null;
  })[] = [];
  private seq = 0;

  async reserve(input: {
    thread: ConversationThread;
    conversationId: string;
    assemblyLineId: string | null;
    iteration?: number;
  }): Promise<void> {
    this.rows.push({
      id: `conv-row-${++this.seq}`,
      thread: input.thread,
      conversationId: input.conversationId,
      objectKey: null,
      bytes: null,
      assemblyLineId: input.assemblyLineId,
      iteration: input.iteration ?? null,
      createdAt: new Date(this.seq).toISOString(),
    });
  }

  async attachArchive(
    conversationId: string,
    objectKey: string,
    bytes: number,
  ): Promise<boolean> {
    const row = this.rows.find((r) => r.conversationId === conversationId);

    if (!row) {
      return false;
    }

    row.objectKey = objectKey;
    row.bytes = bytes;

    return true;
  }

  async latestFor(
    thread: ConversationThread,
    opts: { exclude?: ExecutionRef; from?: ExecutionRef } = {},
  ): Promise<ConversationRecord | null> {
    const matches = this.rows.filter(
      (r) =>
        sameThread(r.thread, thread) &&
        r.objectKey !== null &&
        !(opts.exclude && isExecution(r, opts.exclude)) &&
        (!opts.from || isExecution(r, opts.from)),
    );

    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  async byConversationId(
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    return this.rows.find((r) => r.conversationId === conversationId) ?? null;
  }
}
