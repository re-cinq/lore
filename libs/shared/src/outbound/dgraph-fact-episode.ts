import { createHash, randomUUID } from "node:crypto";
import type { DgraphClientPort, DgraphTxn } from "./memory-store.js";
import { embeddingField, newUid, toVectorLiteral } from "./dgraph-vector.js";
import { withTxn } from "./dgraph-txn.js";
import { contradictionNodes } from "./dgraph-fact-contradictions.js";
import { firstOf } from "../lib/row.js";

interface FactInput {
  text: string;
  agentId: string;
  embedding?: number[];
  confidence?: string;
}

export async function persistFact(
  client: DgraphClientPort,
  input: FactInput,
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const xid = randomUUID();

  return withTxn(client, async (txn) => {
    const factUid = await insertFact(txn, input, { xid, now });

    // Contradiction detection is vector work, so a fact stored without an embedding simply cannot invalidate anything.
    if (input.embedding) {
      await invalidateContradictions(client, input.agentId, input.embedding, {
        xid,
        uid: factUid,
        now,
      });
    }

    return { id: xid };
  });
}

/** Writes the fact and hands back the uid dgraph assigned its blank node, which contradiction detection needs to point its FactConflict edges at. */
async function insertFact(
  txn: DgraphTxn,
  input: FactInput,
  seed: { xid: string; now: string },
): Promise<string | undefined> {
  const created = await txn.mutate({
    setJson: {
      uid: "_:newfact",
      "dgraph.type": "Fact",
      "Fact.xid": seed.xid,
      ...factFields(input, seed.now),
    },
    commitNow: true,
  });

  return newUid(created, "newfact");
}

function factFields(input: FactInput, now: string): Record<string, unknown> {
  return {
    "Fact.agent_id": input.agentId,
    "Fact.text": input.text,
    "Fact.active": true,
    "Fact.valid_from": now,
    "Fact.created_at": now,
    "Fact.confidence": input.confidence ?? "observed",
    ...embeddingField(input.embedding, "Fact.embedding"),
  };
}

/** Postgres-parity contradiction detection: over-fetches active facts by vector ANN, recomputes cosine in TS, and marks every prior fact at/above threshold inactive with a FactConflict edge. */
async function invalidateContradictions(
  client: DgraphClientPort,
  agentId: string,
  embedding: number[],
  newFact: { xid: string; uid: string | undefined; now: string },
): Promise<void> {
  const { xid: newXid, uid: newFactUid, now } = newFact;
  const candidates = await nearbyActiveFacts(client, agentId, embedding);
  const nodes = candidates
    .filter((candidate) => candidate["Fact.xid"] !== newXid)
    .flatMap((candidate) =>
      contradictionNodes(candidate, embedding, newFactUid, now),
    );

  if (nodes.length === 0) {
    return;
  }

  await withTxn(client, (txn) =>
    txn.mutate({ setJson: nodes, commitNow: true }),
  );
}

/** The 40 nearest ACTIVE facts by ANN. Over-fetching is deliberate: the index gives an approximate neighborhood, and the exact cosine that decides contradiction is recomputed in TS over this candidate set. */
async function nearbyActiveFacts(
  client: DgraphClientPort,
  agentId: string,
  embedding: number[],
): Promise<Record<string, unknown>[]> {
  return withTxn(client, async (txn) => {
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
}

/** The content hash is stored, not just used: it is what makes a re-ingested episode a lookup rather than a duplicate. */
interface EpisodeInput {
  content: string;
  agentId: string;
  source?: string;
  ref?: string;
  embedding?: number[];
}

export async function writeEpisode(
  client: DgraphClientPort,
  input: EpisodeInput,
): Promise<{ id: string }> {
  const contentHash = createHash("sha256").update(input.content).digest("hex");

  return withTxn(client, async (txn) => {
    const existing = await findEpisodeXid(txn, contentHash);

    if (existing) {
      return { id: existing };
    }

    return { id: await insertEpisode(txn, input, contentHash) };
  });
}

const FIND_EPISODE_QUERY = `query find($h: string) {
        found(func: eq(Episode.content_hash, $h), first: 1) { uid Episode.xid }
      }`;

async function findEpisodeXid(
  txn: DgraphTxn,
  contentHash: string,
): Promise<string | undefined> {
  const res = await txn.queryWithVars(FIND_EPISODE_QUERY, { $h: contentHash });

  return firstOf(res.data.found)?.["Episode.xid"] as string | undefined;
}

async function insertEpisode(
  txn: DgraphTxn,
  input: EpisodeInput,
  contentHash: string,
): Promise<string> {
  const xid = randomUUID();

  await txn.mutate({
    setJson: {
      "dgraph.type": "Episode",
      "Episode.xid": xid,
      ...episodeFields(input, contentHash),
    },
    commitNow: true,
  });

  return xid;
}

function episodeFields(
  input: EpisodeInput,
  contentHash: string,
): Record<string, unknown> {
  return {
    "Episode.agent_id": input.agentId,
    "Episode.content": input.content,
    "Episode.content_hash": contentHash,
    "Episode.created_at": new Date().toISOString(),
    ...(input.source ? { "Episode.source": input.source } : {}),
    ...(input.ref ? { "Episode.ref": input.ref } : {}),
    ...embeddingField(input.embedding, "Episode.embedding"),
  };
}
