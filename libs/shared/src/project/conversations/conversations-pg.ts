import type { PgPool } from "../../memory-store.js";
import type {
  ConversationRecord,
  ConversationThread,
  ConversationsPort,
  ExecutionRef,
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
    iteration?: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.agent_conversations
         (key_kind, key_value, node_id, conversation_id, assembly_line_id,
          iteration)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (conversation_id) DO NOTHING`,
      [
        input.thread.kind,
        input.thread.value,
        input.thread.nodeId,
        input.conversationId,
        input.assemblyLineId,
        input.iteration ?? null,
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
    opts: { exclude?: ExecutionRef; from?: ExecutionRef } = {},
  ): Promise<ConversationRecord | null> {
    // object_key IS NOT NULL is load-bearing: reserved ids require an uploaded archive (migration 0038).
    const result = await this.pool.query<ConversationDbRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM pipeline.agent_conversations
        WHERE key_kind = $1 AND key_value = $2 AND node_id = $3
          AND object_key IS NOT NULL
          -- COALESCE(iteration, 1) required (migration 0038): match node execution not line.
          -- Null iteration in ref means "any execution on that line".
          AND NOT (
            $4::uuid IS NOT NULL
            AND assembly_line_id = $4::uuid
            AND ($5::int IS NULL OR COALESCE(iteration, 1) = $5::int)
          )
          AND ($6::uuid IS NULL OR (
            assembly_line_id = $6::uuid
            AND ($7::int IS NULL OR COALESCE(iteration, 1) = $7::int)
          ))
        ORDER BY created_at DESC
        LIMIT 1`,
      [
        thread.kind,
        thread.value,
        thread.nodeId,
        opts.exclude?.assemblyLineId ?? null,
        opts.exclude?.iteration ?? null,
        opts.from?.assemblyLineId ?? null,
        opts.from?.iteration ?? null,
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
