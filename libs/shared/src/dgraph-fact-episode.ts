import { createHash, randomUUID } from "node:crypto";
import type { DgraphClientPort } from "./memory-store.js";
import { embeddingField, newUid, toVectorLiteral } from "./dgraph-vector.js";
import { withTxn } from "./dgraph-txn.js";
import { contradictionNodes } from "./dgraph-fact-contradictions.js";

/** Postgres-parity contradiction detection: over-fetches active facts by vector ANN, recomputes cosine in TS, and marks every prior fact at/above threshold inactive with a FactConflict edge. */
async function invalidateContradictions(
  client: DgraphClientPort,
  agentId: string,
  embedding: number[],
  newFact: { xid: string; uid: string | undefined; now: string },
): Promise<void> {
  const { xid: newXid, uid: newFactUid, now } = newFact;
  const candidates = await withTxn(client, async (txn) => {
    const res = await txn.queryWithVars(
      `query cand($vec: string, $agent: string) {
        cand(func: similar_to(Fact.embedding, 40, $vec))
          @filter(eq(Fact.active, true) AND eq(Fact.agent_id, $agent)) {
          uid Fact.xid Fact.embedding
        }
      }`,
      { $vec: toVectorLiteral(embedding), $agent: agentId },
    );

    return (res.data.cand ?? []) as Record<string, unknown>[];
  });

  const nodes: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    if (candidate["Fact.xid"] === newXid) {
      continue;
    }
    nodes.push(...contradictionNodes(candidate, embedding, newFactUid, now));
  }

  if (nodes.length === 0) {
    return;
  }

  await withTxn(client, (txn) =>
    txn.mutate({ setJson: nodes, commitNow: true }),
  );
}

export async function persistFact(
  client: DgraphClientPort,
  input: {
    text: string;
    agentId: string;
    embedding?: number[];
    confidence?: string;
  },
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const xid = randomUUID();

  return withTxn(client, async (txn) => {
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

      await invalidateContradictions(client, input.agentId, input.embedding, {
        xid,
        uid: factUid,
        now,
      });
    }

    return { id: xid };
  });
}

export async function writeEpisode(
  client: DgraphClientPort,
  input: {
    content: string;
    agentId: string;
    source?: string;
    ref?: string;
    embedding?: number[];
  },
): Promise<{ id: string }> {
  const contentHash = createHash("sha256").update(input.content).digest("hex");

  return withTxn(client, async (txn) => {
    const res = await txn.queryWithVars(
      `query find($h: string) {
        found(func: eq(Episode.content_hash, $h), first: 1) { uid Episode.xid }
      }`,
      { $h: contentHash },
    );
    const found = res.data.found?.[0];

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
