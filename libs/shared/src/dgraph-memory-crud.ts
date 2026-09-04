import { randomUUID } from "node:crypto";
import type {
  DgraphClientPort,
  MemoryRecord,
  WriteResult,
} from "./memory-store.js";
import { embeddingField } from "./dgraph-vector.js";
import { withTxn } from "./dgraph-txn.js";
import {
  EXISTENCE_PROJECTION,
  FULL_MEMORY_PROJECTION,
  LIVE_FILTER,
  findLatestLive,
  listMemoriesVars,
  toMemorySummary,
  extractMemoryRows,
  extractTotalCount,
} from "./dgraph-memory-queries.js";

export async function writeMemory(
  client: DgraphClientPort,
  input: {
    key: string;
    value: string;
    agentId: string;
    ttl?: number;
    embedding?: number[];
    repo?: string;
  },
): Promise<WriteResult> {
  const createdAt = new Date().toISOString();

  return withTxn(client, async (txn) => {
    const existing = await findLatestLive(
      txn,
      EXISTENCE_PROJECTION,
      input.agentId,
      input.key,
    );

    if (existing) {
      const nextVersion = existing.version + 1;

      await txn.mutate({
        setJson: {
          uid: existing.uid,
          "Memory.value": input.value,
          "Memory.version": nextVersion,
          ...embeddingField(input.embedding),
        },
        commitNow: true,
      });

      return {
        key: input.key,
        version: nextVersion,
        agent_id: input.agentId,
        created_at: createdAt,
      };
    }

    await txn.mutate({
      setJson: {
        "dgraph.type": "Memory",
        "Memory.xid": randomUUID(),
        "Memory.agent_id": input.agentId,
        "Memory.key": input.key,
        "Memory.value": input.value,
        "Memory.version": 1,
        "Memory.is_deleted": false,
        "Memory.created_at": createdAt,
        ...embeddingField(input.embedding),
      },
      commitNow: true,
    });

    return {
      key: input.key,
      version: 1,
      agent_id: input.agentId,
      created_at: createdAt,
    };
  });
}

export async function readMemory(
  client: DgraphClientPort,
  key: string,
  agentId: string,
): Promise<MemoryRecord | MemoryRecord[] | null> {
  return withTxn(client, async (txn) => {
    const row = await findLatestLive(txn, FULL_MEMORY_PROJECTION, agentId, key);

    if (!row) {
      return null;
    }

    return { key: row.key, value: row.value, version: row.version };
  });
}

export async function deleteMemory(
  client: DgraphClientPort,
  key: string,
  agentId: string,
): Promise<{ key: string; deleted: boolean }> {
  return withTxn(client, async (txn) => {
    const existing = await findLatestLive(
      txn,
      EXISTENCE_PROJECTION,
      agentId,
      key,
    );

    if (existing) {
      await txn.mutate({
        setJson: { uid: existing.uid, "Memory.is_deleted": true },
        commitNow: true,
      });
    }

    return { key, deleted: true };
  });
}

export async function listMemories(
  client: DgraphClientPort,
  opts: {
    agentId?: string;
    limit?: number;
    offset?: number;
    repo?: string;
  },
): Promise<{ memories: MemoryRecord[]; total: number }> {
  return withTxn(client, async (txn) => {
    const res = await txn.queryWithVars(
      `query list($agent: string, $now: string, $first: int, $offset: int) {
        memories(func: eq(Memory.agent_id, $agent), first: $first, offset: $offset)
          @filter(${LIVE_FILTER}) {
          Memory.key Memory.agent_id Memory.version
        }
        total(func: eq(Memory.agent_id, $agent)) @filter(${LIVE_FILTER}) {
          count(uid)
        }
      }`,
      listMemoriesVars(opts),
    );

    return {
      memories: extractMemoryRows(res).map(toMemorySummary),
      total: extractTotalCount(res),
    };
  });
}
