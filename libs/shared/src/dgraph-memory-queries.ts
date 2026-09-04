import type { DgraphTxn } from "./memory-store.js";

// ── Latest-live-Memory query ─────────────────────────────────────────

/** The single definition of "the latest live Memory node for an (agent, key)" — not-deleted, not-expired, highest version — shared by writeMemory and readMemory. */
export const LIVE_FILTER = `eq(Memory.is_deleted, false)
        AND (NOT has(Memory.expires_at) OR gt(Memory.expires_at, $now))`;

export function latestLiveMemoryQuery(projection: string): string {
  return `query latest($agent: string, $key: string, $now: string) {
    latest(func: eq(Memory.agent_id, $agent), orderdesc: Memory.version, first: 1)
      @filter(eq(Memory.key, $key) AND ${LIVE_FILTER}) {
      ${projection}
    }
  }`;
}

export const EXISTENCE_PROJECTION = "uid Memory.version";
export const FULL_MEMORY_PROJECTION = "Memory.key Memory.value Memory.version";

export interface MemoryRow {
  uid?: string;
  key: string;
  value: string;
  version: number;
}

/** Strips the `Memory.` predicate prefix off every key in a Dgraph row so call sites destructure plain field names; `uid` passes through untouched. */
export function stripMemoryPrefix(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const [predicate, value] of Object.entries(row)) {
    fields[
      predicate.startsWith("Memory.")
        ? predicate.slice("Memory.".length)
        : predicate
    ] = value;
  }

  return fields;
}

function toMemoryRow(row: Record<string, unknown>): MemoryRow {
  const { uid, key, value, version } = stripMemoryPrefix(row);

  return {
    uid: uid as string | undefined,
    key: key as string,
    value: value as string,
    version: version as number,
  };
}

/** Looks up the latest live Memory node for (agentId, key), projecting only `projection`'s predicates. */
export async function findLatestLive(
  txn: DgraphTxn,
  projection: string,
  agentId: string,
  key: string,
): Promise<MemoryRow | null> {
  const res = await txn.queryWithVars(latestLiveMemoryQuery(projection), {
    $agent: agentId,
    $key: key,
    $now: new Date().toISOString(),
  });
  const row = res.data?.latest?.[0];

  return row ? toMemoryRow(row) : null;
}

export function listMemoriesVars(opts: {
  agentId?: string;
  limit?: number;
  offset?: number;
}): Record<string, string> {
  return {
    $agent: opts.agentId ?? "",
    $now: new Date().toISOString(),
    $first: String(opts.limit ?? 50),
    $offset: String(opts.offset ?? 0),
  };
}

export function toMemorySummary(row: Record<string, unknown>): {
  key: string;
  agent_id: string;
  version: number;
} {
  const { key, agent_id, version } = stripMemoryPrefix(row);

  return {
    key: key as string,
    agent_id: agent_id as string,
    version: version as number,
  };
}

export type DgraphQueryResult = {
  data: Record<string, Record<string, unknown>[]>;
};

export function extractMemoryRows(
  res: DgraphQueryResult,
): Record<string, unknown>[] {
  return res.data?.memories ?? [];
}

export function extractTotalCount(res: DgraphQueryResult): number {
  return (res.data?.total?.[0]?.count as number) ?? 0;
}
