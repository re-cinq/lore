import type {
  ConversationRecord,
  ConversationThread,
  ConversationsPort,
} from "./conversations-port.js";

const sameThread = (a: ConversationThread, b: ConversationThread): boolean =>
  a.kind === b.kind && a.value === b.value && a.nodeId === b.nodeId;

/** In-memory ConversationsPort — the behavioural spec the Pg adapter must match. */
export class InMemoryConversations implements ConversationsPort {
  readonly rows: (ConversationRecord & { thread: ConversationThread })[] = [];
  private seq = 0;

  async reserve(input: {
    thread: ConversationThread;
    conversationId: string;
    assemblyLineId: string | null;
  }): Promise<void> {
    this.rows.push({
      id: `conv-row-${++this.seq}`,
      thread: input.thread,
      conversationId: input.conversationId,
      objectKey: null,
      bytes: null,
      assemblyLineId: input.assemblyLineId,
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
    opts: { excludeAssemblyLineId?: string; fromAssemblyLineId?: string } = {},
  ): Promise<ConversationRecord | null> {
    const matches = this.rows.filter(
      (r) =>
        sameThread(r.thread, thread) &&
        r.objectKey !== null &&
        r.assemblyLineId !== opts.excludeAssemblyLineId &&
        (!opts.fromAssemblyLineId ||
          r.assemblyLineId === opts.fromAssemblyLineId),
    );

    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  async byConversationId(
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    return this.rows.find((r) => r.conversationId === conversationId) ?? null;
  }
}
