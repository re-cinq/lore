import type { PgPool } from "../../memory-store.js";
import type {
  ConversationRecord,
  ConversationThread,
  ConversationsPort,
} from "./conversations-port.js";

/** The shape `pipeline.agent_conversations` hands back. */
interface ConversationDbRow {
  id: string;
  conversation_id: string;
  object_key: string | null;
  bytes: number | null;
  assembly_line_id: string | null;
  created_at: Date;
}

const SELECT_COLUMNS = `id, conversation_id, object_key, bytes,
         assembly_line_id, created_at`;

const toRecord = (row: ConversationDbRow): ConversationRecord => ({
  id: row.id,
  conversationId: row.conversation_id,
  objectKey: row.object_key,
  bytes: row.bytes,
  assemblyLineId: row.assembly_line_id,
  createdAt: row.created_at.toISOString(),
});

export class PgConversations implements ConversationsPort {
  constructor(private readonly pool: PgPool) {}

  async reserve(input: {
    thread: ConversationThread;
    conversationId: string;
    assemblyLineId: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.agent_conversations
         (key_kind, key_value, node_id, conversation_id, assembly_line_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conversation_id) DO NOTHING`,
      [
        input.thread.kind,
        input.thread.value,
        input.thread.nodeId,
        input.conversationId,
        input.assemblyLineId,
      ],
    );
  }

  async attachArchive(
    conversationId: string,
    objectKey: string,
    bytes: number,
  ): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE pipeline.agent_conversations
          SET object_key = $2, bytes = $3
        WHERE conversation_id = $1
        RETURNING id`,
      [conversationId, objectKey, bytes],
    );

    return result.rows.length > 0;
  }

  async latestFor(
    thread: ConversationThread,
    opts: { excludeAssemblyLineId?: string; fromAssemblyLineId?: string } = {},
  ): Promise<ConversationRecord | null> {
    // `object_key IS NOT NULL` is the load-bearing clause: a reserved id whose run
    // never uploaded cannot be resumed, and offering it would send the next pod
    // after an object that does not exist — a fetch that fails silently by design.
    const result = await this.pool.query<ConversationDbRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM pipeline.agent_conversations
        WHERE key_kind = $1 AND key_value = $2 AND node_id = $3
          AND object_key IS NOT NULL
          AND ($4::uuid IS NULL OR assembly_line_id IS DISTINCT FROM $4::uuid)
          AND ($5::uuid IS NULL OR assembly_line_id = $5::uuid)
        ORDER BY created_at DESC
        LIMIT 1`,
      [
        thread.kind,
        thread.value,
        thread.nodeId,
        opts.excludeAssemblyLineId ?? null,
        opts.fromAssemblyLineId ?? null,
      ],
    );

    return result.rows.length > 0 ? toRecord(result.rows[0]) : null;
  }

  async byConversationId(
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const result = await this.pool.query<ConversationDbRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM pipeline.agent_conversations
        WHERE conversation_id = $1`,
      [conversationId],
    );

    return result.rows.length > 0 ? toRecord(result.rows[0]) : null;
  }
}
