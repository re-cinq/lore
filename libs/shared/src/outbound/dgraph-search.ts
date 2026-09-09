import type { DgraphClientPort } from "./memory-store.js";
import {
  rrfMerge,
  type MemorySearchResult,
  type RankedItem,
} from "../domain/memory-ranking.js";
import { toVectorLiteral } from "./dgraph-vector.js";
import {
  stripMemoryPrefix,
  type DgraphQueryResult,
} from "./dgraph-memory-queries.js";
import { withTxn } from "./dgraph-txn.js";

const KMEM_BLOCK = `kmem(func: anyoftext(Memory.value, $q), orderdesc: Memory.created_at, first: 20)
          @filter(eq(Memory.is_deleted, false)) {
          Memory.key Memory.value Memory.agent_id
        }`;

const VMEM_BLOCK = `vmem(func: similar_to(Memory.embedding, 20, $vec)) @filter(eq(Memory.is_deleted, false)) {
          Memory.key Memory.value Memory.agent_id
        }`;

function buildSearchQuery(hasEmbedding: boolean): string {
  if (!hasEmbedding) {
    return `query search($q: string) {\n${KMEM_BLOCK}\n}`;
  }

  return `query search($q: string, $vec: string) {\n${KMEM_BLOCK}\n${VMEM_BLOCK}\n}`;
}

function searchVars(
  query: string,
  embedding: number[] | undefined,
): Record<string, string> {
  const vars: Record<string, string> = { $q: query };

  if (embedding) {
    vars.$vec = toVectorLiteral(embedding);
  }

  return vars;
}

function extractRows(
  res: DgraphQueryResult,
  key: string,
): Record<string, unknown>[] {
  return res.data[key] ?? [];
}

function mergedSearchLists(
  res: DgraphQueryResult,
  hasEmbedding: boolean,
  toItems: (rows: Record<string, unknown>[]) => RankedItem[],
): RankedItem[][] {
  const kmemItems = toItems(extractRows(res, "kmem"));

  if (!hasEmbedding) {
    return [kmemItems];
  }

  return [toItems(extractRows(res, "vmem")), kmemItems];
}

function limitResults<T>(results: T[], limit: number | undefined): T[] {
  return limit ? results.slice(0, limit) : results;
}

function toRankedMemory(rows: Record<string, unknown>[]): RankedItem[] {
  return rows.map((row) => {
    const { key, value, agent_id } = stripMemoryPrefix(row);

    return {
      key: key as string,
      value: value as string,
      agent_id: agent_id as string,
      source: "memory" as const,
    };
  });
}

/** Hybrid keyword (anyoftext) + vector (similar_to) Memory search, fused via reciprocal rank fusion; the vector leg is omitted entirely when the caller has no embedding. */
export async function searchMemories(
  client: DgraphClientPort,
  query: string,
  opts: { agentId?: string; limit?: number; embedding?: number[] },
): Promise<MemorySearchResult[]> {
  return withTxn(client, async (txn) => {
    const hasEmbedding = Boolean(opts.embedding);
    const res = await txn.queryWithVars(
      buildSearchQuery(hasEmbedding),
      searchVars(query, opts.embedding),
    );
    const fused = rrfMerge(
      mergedSearchLists(res, hasEmbedding, toRankedMemory),
    );

    return limitResults(fused, opts.limit);
  });
}
