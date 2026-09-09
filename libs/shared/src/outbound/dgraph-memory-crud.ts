import { randomUUID } from "node:crypto";
import type {
  DgraphClientPort,
  DgraphTxn,
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
  type MemoryRow,
} from "./dgraph-memory-queries.js";

type MemoryWriteInput = {
  key: string;
  value: string;
  agentId: string;
  ttl?: number;
  embedding?: number[];
  repo?: string;
};

export async function writeMemory(
  client: DgraphClientPort,
  input: MemoryWriteInput,
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
      return await bumpMemoryVersion(txn, existing, input, createdAt);
    }

    return await insertFirstMemoryVersion(txn, input, createdAt);
  });
}

/** An update touches only what changes — value, version, embedding. The identity fields written on the first version are never rewritten, so a later write cannot move a memory to another agent or key. */
async function bumpMemoryVersion(
  txn: DgraphTxn,
  existing: MemoryRow,
  input: MemoryWriteInput,
  createdAt: string,
): Promise<WriteResult> {
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

  return writeResult(input, nextVersion, createdAt);
}

async function insertFirstMemoryVersion(
  txn: DgraphTxn,
  input: MemoryWriteInput,
  createdAt: string,
): Promise<WriteResult> {
  await txn.mutate({
    setJson: newMemoryFields(input, createdAt),
    commitNow: true,
  });

  return writeResult(input, 1, createdAt);
}

function newMemoryFields(
  input: MemoryWriteInput,
  createdAt: string,
): Record<string, unknown> {
  return {
    "dgraph.type": "Memory",
    "Memory.xid": randomUUID(),
    "Memory.agent_id": input.agentId,
    "Memory.key": input.key,
    "Memory.value": input.value,
    "Memory.version": 1,
    "Memory.is_deleted": false,
    "Memory.created_at": createdAt,
    ...embeddingField(input.embedding),
  };
}

/** The caller-facing acknowledgement of a write, identical whichever version it was. */
function writeResult(
  input: MemoryWriteInput,
  version: number,
  createdAt: string,
): WriteResult {
  return {
    key: input.key,
    version,
    agent_id: input.agentId,
    created_at: createdAt,
  };
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
      await markDeleted(txn, existing.uid);
    }

    return { key, deleted: true };
  });
}

/** A delete is a flag, not a removal: the version history stays readable, and a later write picks up where it left off. */
async function markDeleted(txn: DgraphTxn, uid: unknown): Promise<void> {
  await txn.mutate({
    setJson: { uid, "Memory.is_deleted": true },
    commitNow: true,
  });
}

interface ListMemoriesOpts {
  agentId?: string;
  limit?: number;
  offset?: number;
  repo?: string;
}

const LIST_MEMORIES_QUERY = `query list($agent: string, $now: string, $first: int, $offset: int) {
        memories(func: eq(Memory.agent_id, $agent), first: $first, offset: $offset)
          @filter(${LIVE_FILTER}) {
          Memory.key Memory.agent_id Memory.version
        }
        total(func: eq(Memory.agent_id, $agent)) @filter(${LIVE_FILTER}) {
          count(uid)
        }
      }`;

export async function listMemories(
  client: DgraphClientPort,
  opts: ListMemoriesOpts,
): Promise<{ memories: MemoryRecord[]; total: number }> {
  return withTxn(client, async (txn) => {
    const res = await txn.queryWithVars(
      LIST_MEMORIES_QUERY,
      listMemoriesVars(opts),
    );

    return {
      memories: extractMemoryRows(res).map(toMemorySummary),
      total: extractTotalCount(res),
    };
  });
}
