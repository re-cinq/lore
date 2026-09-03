/** Dgraph implementation of the MemoryStore seam, sibling of PostgresMemoryStore; depends only on the injected DgraphClientPort, never imports the driver. */

import { createHash, randomUUID } from "node:crypto";
import type {
  DgraphClientPort,
  DgraphTxn,
  MemoryRecord,
  MemoryStore,
  WriteResult,
} from "./memory-store.js";
import {
  rrfMerge,
  type MemorySearchResult,
  type RankedItem,
} from "./memory-ranking.js";
import { cosineSimilarity, parseEmbedding } from "./spec-judge.js";

/** Cosine at/above which a new fact is treated as contradicting an older one. */
const FACT_SIMILARITY_THRESHOLD = 0.92;

// ── Vector literal ───────────────────────────────────────────────────

/** Dgraph demands a float vector as a bracketed STRING literal (e.g. "[0.1,0.2,0.3]") — a raw JSON array is rejected; lives here once, used by every write path and $vec. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** The optional embedding predicate, spread into a mutation's setJson (`{}` when absent); predicate defaults to `Memory.embedding`, persistFact passes `Fact.embedding`. */
function embeddingField(
  embedding?: number[],
  predicate = "Memory.embedding",
): Record<string, string> {
  return embedding ? { [predicate]: toVectorLiteral(embedding) } : {};
}

// ── Latest-live-Memory query ─────────────────────────────────────────

/** The single definition of "the latest live Memory node for an (agent, key)" — not-deleted, not-expired, highest version — shared by writeMemory and readMemory. */
const LIVE_FILTER = `eq(Memory.is_deleted, false)
        AND (NOT has(Memory.expires_at) OR gt(Memory.expires_at, $now))`;

function latestLiveMemoryQuery(projection: string): string {
  return `query latest($agent: string, $key: string, $now: string) {
    latest(func: eq(Memory.agent_id, $agent), orderdesc: Memory.version, first: 1)
      @filter(eq(Memory.key, $key) AND ${LIVE_FILTER}) {
      ${projection}
    }
  }`;
}

const EXISTENCE_PROJECTION = "uid Memory.version";
const FULL_MEMORY_PROJECTION = "Memory.key Memory.value Memory.version";

interface MemoryRow {
  uid?: string;
  key: string;
  value: string;
  version: number;
}

/** Strips the `Memory.` predicate prefix off every key in a Dgraph row so call sites destructure plain field names; `uid` passes through untouched. */
function stripMemoryPrefix(
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

/** Reads the assigned uid of a blank node back out of a mutation result; `label` is the blank node name without its `_:` prefix. */
function newUid(mutateResult: unknown, label: string): string | undefined {
  return (mutateResult as { data?: { uids?: Record<string, string> } }).data
    ?.uids?.[label];
}

// ── Graph hop ────────────────────────────────────────────────────────

/** One traversed relationship in a graph query result. */
export interface GraphHop {
  entity: string;
  relation: string;
  related_entity: string;
  direction: "outgoing" | "incoming";
  depth: number;
  valid_from?: string;
}

/** Walks a `@recurse` tree depth-first, flattening it into per-hop `GraphHop`s until `maxDepth`; `GraphRel.target` arrives as an object under `@recurse` and is normalized defensively. */
function flattenHops(
  entity: Record<string, unknown>,
  maxDepth: number,
  depth = 1,
): GraphHop[] {
  if (depth > maxDepth) {
    return [];
  }
  const rels = (entity["Entity.out_rels"] ?? []) as Record<string, unknown>[];
  const hops: GraphHop[] = [];

  for (const rel of rels) {
    const targetNode = rel["GraphRel.target"];
    const target = (Array.isArray(targetNode) ? targetNode[0] : targetNode) as
      Record<string, unknown> | undefined;

    hops.push({
      entity: entity["Entity.name"] as string,
      relation: rel["GraphRel.relation_type"] as string,
      related_entity: target?.["Entity.name"] as string,
      direction: "outgoing",
      depth,
      valid_from: rel["GraphRel.valid_from"] as string | undefined,
    });

    if (target) {
      hops.push(...flattenHops(target, maxDepth, depth + 1));
    }
  }

  return hops;
}

// ── Store ────────────────────────────────────────────────────────────

export class DgraphMemoryStore implements MemoryStore {
  readonly backend = "dgraph" as const;

  constructor(private readonly client: DgraphClientPort) {}

  private async withTxn<T>(fn: (txn: DgraphTxn) => Promise<T>): Promise<T> {
    const txn = this.client.newTxn();

    try {
      return await fn(txn);
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  private async findLatestLive(
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

  async writeMemory(input: {
    key: string;
    value: string;
    agentId: string;
    ttl?: number;
    embedding?: number[];
    repo?: string;
  }): Promise<WriteResult> {
    const createdAt = new Date().toISOString();

    return this.withTxn(async (txn) => {
      const existing = await this.findLatestLive(
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

  async persistFact(input: {
    text: string;
    agentId: string;
    embedding?: number[];
    confidence?: string;
  }): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const xid = randomUUID();

    return this.withTxn(async (txn) => {
      const created = await txn.mutate({
        setJson: {
          uid: "_:newfact",
          "dgraph.type": "Fact",
          "Fact.xid": xid,
          "Fact.agent_id": input.agentId,
          "Fact.text": input.text,
          "Fact.active": true,
          "Fact.valid_from": now,
          "Fact.created_at": now,
          "Fact.confidence": input.confidence ?? "observed",
          ...embeddingField(input.embedding, "Fact.embedding"),
        },
        commitNow: true,
      });

      if (input.embedding) {
        const factUid = newUid(created, "newfact");

        await this.invalidateContradictions(
          input.agentId,
          input.embedding,
          { xid, uid: factUid },
          now,
        );
      }

      return { id: xid };
    });
  }

  /** Postgres-parity contradiction detection: over-fetches active facts by vector ANN, recomputes cosine in TS, and marks every prior fact at/above threshold inactive with a FactConflict edge. */
  private async invalidateContradictions(
    agentId: string,
    embedding: number[],
    { xid: newXid, uid: newUid }: { xid: string; uid: string | undefined },
    now: string,
  ): Promise<void> {
    const candidates = await this.withTxn(async (txn) => {
      const res = await txn.queryWithVars(
        `query cand($vec: string, $agent: string) {
          cand(func: similar_to(Fact.embedding, 40, $vec))
            @filter(eq(Fact.active, true) AND eq(Fact.agent_id, $agent)) {
            uid Fact.xid Fact.embedding
          }
        }`,
        { $vec: toVectorLiteral(embedding), $agent: agentId },
      );

      return (res.data?.cand ?? []) as Record<string, unknown>[];
    });

    const nodes: Record<string, unknown>[] = [];

    for (const candidate of candidates) {
      if (candidate["Fact.xid"] === newXid) {
        continue;
      }
      const candEmbedding = parseEmbedding(candidate["Fact.embedding"]);

      if (!candEmbedding) {
        continue;
      }
      const similarity = cosineSimilarity(embedding, candEmbedding);

      if (similarity < FACT_SIMILARITY_THRESHOLD) {
        continue;
      }

      nodes.push({
        uid: candidate.uid,
        "Fact.active": false,
        "Fact.valid_to": now,
        ...(newUid ? { "Fact.invalidated_by": { uid: newUid } } : {}),
      });
      nodes.push({
        "dgraph.type": "FactConflict",
        "FactConflict.xid": randomUUID(),
        "FactConflict.old_fact": { uid: candidate.uid },
        ...(newUid ? { "FactConflict.new_fact": { uid: newUid } } : {}),
        "FactConflict.similarity": similarity,
        "FactConflict.created_at": now,
      });
    }

    if (nodes.length === 0) {
      return;
    }

    await this.withTxn((txn) =>
      txn.mutate({ setJson: nodes, commitNow: true }),
    );
  }

  async writeEpisode(input: {
    content: string;
    agentId: string;
    source?: string;
    ref?: string;
    embedding?: number[];
  }): Promise<{ id: string }> {
    const contentHash = createHash("sha256")
      .update(input.content)
      .digest("hex");

    return this.withTxn(async (txn) => {
      const res = await txn.queryWithVars(
        `query find($h: string) {
          found(func: eq(Episode.content_hash, $h), first: 1) { uid Episode.xid }
        }`,
        { $h: contentHash },
      );
      const found = res.data?.found?.[0];

      if (found) {
        return { id: found["Episode.xid"] as string };
      }

      const xid = randomUUID();

      await txn.mutate({
        setJson: {
          "dgraph.type": "Episode",
          "Episode.xid": xid,
          "Episode.agent_id": input.agentId,
          "Episode.content": input.content,
          "Episode.content_hash": contentHash,
          "Episode.created_at": new Date().toISOString(),
          ...(input.source ? { "Episode.source": input.source } : {}),
          ...(input.ref ? { "Episode.ref": input.ref } : {}),
          ...embeddingField(input.embedding, "Episode.embedding"),
        },
        commitNow: true,
      });

      return { id: xid };
    });
  }

  async readMemory(
    key: string,
    agentId: string,
  ): Promise<MemoryRecord | MemoryRecord[] | null> {
    return this.withTxn(async (txn) => {
      const row = await this.findLatestLive(
        txn,
        FULL_MEMORY_PROJECTION,
        agentId,
        key,
      );

      if (!row) {
        return null;
      }

      return { key: row.key, value: row.value, version: row.version };
    });
  }

  async deleteMemory(
    key: string,
    agentId: string,
  ): Promise<{ key: string; deleted: boolean }> {
    return this.withTxn(async (txn) => {
      const existing = await this.findLatestLive(
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

  async listMemories(opts: {
    agentId?: string;
    limit?: number;
    offset?: number;
    repo?: string;
  }): Promise<{ memories: MemoryRecord[]; total: number }> {
    return this.withTxn(async (txn) => {
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
        {
          $agent: opts.agentId ?? "",
          $now: new Date().toISOString(),
          $first: String(opts.limit ?? 50),
          $offset: String(opts.offset ?? 0),
        },
      );
      const memories = (res.data?.memories ?? []).map(
        (row: Record<string, unknown>) => {
          const { key, agent_id, version } = stripMemoryPrefix(row);

          return { key, agent_id, version };
        },
      );

      return {
        memories,
        total: (res.data?.total?.[0]?.count as number) ?? 0,
      };
    });
  }

  private async upsertEntity(
    name: string,
    entityType: string,
    repo: string,
  ): Promise<string> {
    const dedupKey = `${name}|${entityType}|${repo}`;

    return this.withTxn(async (txn) => {
      const res = await txn.queryWithVars(
        `query e($dk: string) { found(func: eq(Entity.dedup_key, $dk), first: 1) { uid } }`,
        { $dk: dedupKey },
      );
      const found = res.data?.found?.[0];

      if (found) {
        return found.uid as string;
      }

      const now = new Date().toISOString();
      const created = await txn.mutate({
        setJson: {
          uid: "_:ent",
          "dgraph.type": "Entity",
          "Entity.xid": randomUUID(),
          "Entity.name": name,
          "Entity.entity_type": entityType,
          "Entity.repo": repo,
          "Entity.dedup_key": dedupKey,
          "Entity.created_at": now,
          "Entity.updated_at": now,
        },
        commitNow: true,
      });

      return newUid(created, "ent") as string;
    });
  }

  async upsertEdge(input: {
    source: string;
    target: string;
    relationType: string;
    entityType?: string;
    repo?: string;
  }): Promise<void> {
    const entityType = input.entityType ?? "";
    const repo = input.repo ?? "";
    const sourceUid = await this.upsertEntity(input.source, entityType, repo);
    const targetUid = await this.upsertEntity(input.target, entityType, repo);
    const now = new Date().toISOString();

    const contradictedUids = await this.findContradictedRels(
      sourceUid,
      input.relationType,
      targetUid,
    );

    const invalidations = contradictedUids.map((relUid) => ({
      uid: relUid,
      "GraphRel.active": false,
      "GraphRel.valid_to": now,
    }));

    await this.withTxn((txn) =>
      txn.mutate({
        setJson: [
          ...invalidations,
          {
            uid: sourceUid,
            "Entity.out_rels": {
              uid: "_:rel",
              "dgraph.type": "GraphRel",
              "GraphRel.xid": randomUUID(),
              "GraphRel.relation_type": input.relationType,
              "GraphRel.active": true,
              "GraphRel.valid_from": now,
              "GraphRel.created_at": now,
              "GraphRel.source": { uid: sourceUid },
              "GraphRel.target": { uid: targetUid },
            },
          },
        ],
        commitNow: true,
      }),
    );
  }

  /** Postgres-parity contradiction detection for graph edges: the source's active edges of this relation pointing at a different target (an exact-duplicate target is left untouched). */
  private async findContradictedRels(
    sourceUid: string,
    relationType: string,
    targetUid: string,
  ): Promise<string[]> {
    return this.withTxn(async (txn) => {
      const res = await txn.queryWithVars(
        `query c($src: string, $rel: string) {
          contradictions(func: uid($src)) {
            Entity.out_rels @filter(eq(GraphRel.relation_type, $rel) AND eq(GraphRel.active, true)) {
              uid
              GraphRel.target { uid }
            }
          }
        }`,
        { $src: sourceUid, $rel: relationType },
      );
      const rels = (res.data?.contradictions?.[0]?.["Entity.out_rels"] ??
        []) as Record<string, unknown>[];

      return rels
        .filter(
          (rel) =>
            (rel["GraphRel.target"] as { uid?: string } | undefined)?.uid !==
            targetUid,
        )
        .map((rel) => rel.uid as string);
    });
  }

  async queryGraph(
    entityName: string,
    depth: number,
    _relationType?: string,
  ): Promise<GraphHop[]> {
    if (!Number.isInteger(depth) || depth < 1) {
      return [];
    }

    // `@recurse(depth: N)` counts PREDICATE levels (3 per graph hop), so `depth` graph hops needs 2*depth+1 levels; `depth` is a validated integer, safe to inline.
    const levels = depth * 2 + 1;

    return this.withTxn(async (txn) => {
      const res = await txn.queryWithVars(
        `query g($name: string) {
          result(func: eq(Entity.name, $name)) @recurse(depth: ${levels}, loop: false) {
            Entity.name
            Entity.out_rels @filter(eq(GraphRel.active, true))
            GraphRel.relation_type
            GraphRel.valid_from
            GraphRel.target
          }
        }`,
        { $name: entityName },
      );
      const root = (res.data?.result ?? [])[0] as
        Record<string, unknown> | undefined;

      if (!root) {
        return [];
      }

      return flattenHops(root, depth);
    });
  }

  async searchMemories(
    query: string,
    opts: { agentId?: string; limit?: number; embedding?: number[] },
  ): Promise<MemorySearchResult[]> {
    return this.withTxn(async (txn) => {
      const toItems = (rows: Record<string, unknown>[]): RankedItem[] =>
        rows.map((row) => {
          const { key, value, agent_id } = stripMemoryPrefix(row);

          return {
            key: key as string,
            value: value as string,
            agent_id: agent_id as string,
            source: "memory" as const,
          };
        });

      const kmemBlock = `kmem(func: anyoftext(Memory.value, $q), orderdesc: Memory.created_at, first: 20)
            @filter(eq(Memory.is_deleted, false)) {
            Memory.key Memory.value Memory.agent_id
          }`;
      const vmemBlock = `vmem(func: similar_to(Memory.embedding, 20, $vec)) @filter(eq(Memory.is_deleted, false)) {
            Memory.key Memory.value Memory.agent_id
          }`;

      const queryText = opts.embedding
        ? `query search($q: string, $vec: string) {
          ${kmemBlock}
          ${vmemBlock}
        }`
        : `query search($q: string) {
          ${kmemBlock}
        }`;
      const vars: Record<string, string> = { $q: query };

      if (opts.embedding) {
        vars.$vec = toVectorLiteral(opts.embedding);
      }

      const res = await txn.queryWithVars(queryText, vars);
      const kmemItems = toItems(res.data?.kmem ?? []);
      const lists = opts.embedding
        ? [toItems(res.data?.vmem ?? []), kmemItems]
        : [kmemItems];
      const fused = rrfMerge(lists);

      return opts.limit ? fused.slice(0, opts.limit) : fused;
    });
  }
}
