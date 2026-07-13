import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import * as dgraph from "dgraph-js-http";
import { backfillMemoryToDgraph } from "./backfill-memory.js";
import { parseEmbedding, cosineSimilarity } from "./spec-judge.js";

/**
 * Backfill exporter (memory-dgraph-migration AC6) — migrates Postgres
 * memory.* into Dgraph, preserving each Postgres UUID as the node xid.
 * Tested against the REAL local Postgres AND the REAL local Dgraph (no
 * mocks). Gated on BOTH being reachable; skips otherwise so `npm test`
 * passes without containers.
 *
 * Kernel facet only: one memory.memories row → one Dgraph Memory node
 * whose Memory.xid EQUALS the Postgres row's id. Nothing about
 * embeddings, idempotency, relationships, or other tables here.
 */

const PG_CONFIG = {
  host: "localhost",
  port: 5432,
  database: "lore",
  user: "postgres",
  password: "lore",
};

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });
    await probe.query("select 1");
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

async function dgraphReachable(): Promise<boolean> {
  try {
    return (
      await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })
    ).ok;
  } catch {
    return false;
  }
}

const reachable = (await pgReachable()) && (await dgraphReachable());

describe.skipIf(!reachable)(
  "backfillMemoryToDgraph (live Postgres + Dgraph)",
  () => {
    const pool = new Pool(PG_CONFIG);
    const clientStub = new dgraph.DgraphClientStub(DGRAPH_HTTP);
    const dgraphClient = new dgraph.DgraphClient(clientStub);

    afterAll(async () => {
      await pool.end();
    });

    async function deleteDgraphNodeByPredicate(
      predicate: string,
      xid: string,
    ): Promise<void> {
      const txn = dgraphClient.newTxn();
      try {
        const res = await txn.queryWithVars(
          `query node($xid: string) { node(func: eq(${predicate}, $xid)) { uid } }`,
          { $xid: xid },
        );
        const uids: string[] = (
          (res.data as { node?: { uid: string }[] }).node ?? []
        ).map((node) => node.uid);
        if (uids.length) {
          await txn.mutate({
            deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
            commitNow: true,
          });
        }
      } catch {
        // best-effort cleanup must never mask the assertion
      } finally {
        await txn.discard().catch(() => {});
      }
    }

    async function deleteDgraphNodeByXid(xid: string): Promise<void> {
      const txn = dgraphClient.newTxn();
      try {
        const res = await txn.queryWithVars(
          `query node($xid: string) { node(func: eq(Memory.xid, $xid)) { uid } }`,
          { $xid: xid },
        );
        const uids: string[] = (
          (res.data as { node?: { uid: string }[] }).node ?? []
        ).map((node) => node.uid);
        if (uids.length) {
          await txn.mutate({
            deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
            commitNow: true,
          });
        }
      } catch {
        // best-effort cleanup must never mask the assertion
      } finally {
        await txn.discard().catch(() => {});
      }
    }

    it("creates a Memory node whose Memory.xid equals the Postgres memories row id", async () => {
      const id = randomUUID();
      const agent = `backfill-test-${randomUUID()}`;

      try {
        await pool.query(
          `INSERT INTO memory.memories (id, agent_id, key, value, version)
         VALUES ($1, $2, 'bf-key', 'bf-value', 1)`,
          [id, agent],
        );

        await backfillMemoryToDgraph({ pgPool: pool, dgraph: dgraphClient });

        const txn = dgraphClient.newTxn();
        try {
          const res = await txn.queryWithVars(
            `query q($xid: string) {
            node(func: eq(Memory.xid, $xid)) {
              Memory.xid Memory.key Memory.value
            }
          }`,
            { $xid: id },
          );
          const node = (res.data as { node?: Record<string, any>[] }).node?.[0];

          expect(node).toMatchObject({
            "Memory.xid": id,
            "Memory.key": "bf-key",
            "Memory.value": "bf-value",
          });
        } finally {
          await txn.discard().catch(() => {});
        }
      } finally {
        await deleteDgraphNodeByXid(id);
        await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
          agent,
        ]);
      }
    });

    it("points Fact.memory at the Memory node carrying the facts.memory_id xid", async () => {
      const memId = randomUUID();
      const factId = randomUUID();
      const agent = `backfill-test-${randomUUID()}`;

      try {
        await pool.query(
          `INSERT INTO memory.memories (id, agent_id, key, value, version)
         VALUES ($1, $2, 'fk-key', 'fk-value', 1)`,
          [memId, agent],
        );
        await pool.query(
          `INSERT INTO memory.facts (id, memory_id, fact_text, valid_from)
         VALUES ($1, $2, 'a derived fact', now())`,
          [factId, memId],
        );

        await backfillMemoryToDgraph({ pgPool: pool, dgraph: dgraphClient });

        const txn = dgraphClient.newTxn();
        try {
          const res = await txn.queryWithVars(
            `query q($fxid: string) {
            fact(func: eq(Fact.xid, $fxid)) {
              Fact.xid
              Fact.memory { Memory.xid }
            }
          }`,
            { $fxid: factId },
          );
          const fact = (res.data as { fact?: Record<string, any>[] }).fact?.[0];

          expect(fact?.["Fact.memory"]?.["Memory.xid"]).toBe(memId);
        } finally {
          await txn.discard().catch(() => {});
        }
      } finally {
        await deleteDgraphNodeByPredicate("Fact.xid", factId);
        await deleteDgraphNodeByXid(memId);
        await pool.query("DELETE FROM memory.facts WHERE id = $1", [factId]);
        await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
          agent,
        ]);
      }
    });

    it("creates exactly one Memory node per xid after running twice", async () => {
      const id = randomUUID();
      const agent = `backfill-idem-${randomUUID()}`;

      try {
        await pool.query(
          `INSERT INTO memory.memories (id, agent_id, key, value, version)
         VALUES ($1, $2, 'idem-key', 'idem-value', 1)`,
          [id, agent],
        );

        await backfillMemoryToDgraph({ pgPool: pool, dgraph: dgraphClient });
        await backfillMemoryToDgraph({ pgPool: pool, dgraph: dgraphClient });

        const txn = dgraphClient.newTxn();
        try {
          const res = await txn.queryWithVars(
            `query q($xid: string) {
            nodes(func: eq(Memory.xid, $xid)) {
              uid
            }
          }`,
            { $xid: id },
          );
          const nodes = (res.data as { nodes?: { uid: string }[] }).nodes ?? [];

          expect(nodes.length).toBe(1);
        } finally {
          await txn.discard().catch(() => {});
        }
      } finally {
        await deleteDgraphNodeByXid(id);
        await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
          agent,
        ]);
      }
    });

    it("preserves the 768-dim embedding so cosine(original, stored) is 1.0", async () => {
      const id = randomUUID();
      const agent = `backfill-emb-${randomUUID()}`;
      const embedding = Array.from({ length: 768 }, (_, i) => Math.sin(i));

      try {
        await pool.query(
          `INSERT INTO memory.memories (id, agent_id, key, value, version, embedding)
         VALUES ($1, $2, 'emb-key', 'emb-value', 1, $3::vector)`,
          [id, agent, `[${embedding.join(",")}]`],
        );

        await backfillMemoryToDgraph({ pgPool: pool, dgraph: dgraphClient });

        const txn = dgraphClient.newTxn();
        try {
          const res = await txn.queryWithVars(
            `query q($xid: string) {
            node(func: eq(Memory.xid, $xid)) {
              Memory.embedding
            }
          }`,
            { $xid: id },
          );
          const node = (res.data as { node?: Record<string, any>[] }).node?.[0];
          const stored = parseEmbedding(node?.["Memory.embedding"]);

          expect(stored?.length).toBe(768);
          expect(cosineSimilarity(embedding, stored ?? [])).toBeCloseTo(1.0, 4);
        } finally {
          await txn.discard().catch(() => {});
        }
      } finally {
        await deleteDgraphNodeByXid(id);
        await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
          agent,
        ]);
      }
    });
  },
);
