import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { DgraphMemoryStore } from "./dgraph-memory-store.js";
import { dgraphReachable } from "./lib/dgraph-test-gate.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("DgraphMemoryStore (live Dgraph)", () => {
  const clientStub = new dgraph.DgraphClientStub(DGRAPH_HTTP);
  const dgraphClient = new dgraph.DgraphClient(clientStub);

  async function deleteAgentNodes(agent: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($agent: string) { nodes(func: eq(Memory.agent_id, $agent)) { uid } }`,
        { $agent: agent },
      );
      const uids: string[] = (
        (res.data as { nodes?: { uid: string }[] }).nodes ?? []
      ).map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      return;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  async function deleteAgentFacts(agent: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($agent: string) { nodes(func: eq(Fact.agent_id, $agent)) { uid } }`,
        { $agent: agent },
      );
      const uids: string[] = (
        (res.data as { nodes?: { uid: string }[] }).nodes ?? []
      ).map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      return;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  it("persistFact writes an active Fact node retrievable for the agent", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.persistFact({
        text: "the deploy pipeline runs on Mondays",
        agentId: agent,
      });

      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(
          `query facts($agent: string) {
            facts(func: eq(Fact.agent_id, $agent)) @filter(eq(Fact.active, true)) {
              Fact.text Fact.active
            }
          }`,
          { $agent: agent },
        );
        const facts =
          (res.data as { facts?: Record<string, any>[] }).facts ?? [];

        expect(facts).toContainEqual(
          expect.objectContaining({
            "Fact.text": "the deploy pipeline runs on Mondays",
            "Fact.active": true,
          }),
        );
      } finally {
        await txn.discard().catch(() => {});
      }
    } finally {
      await deleteAgentFacts(agent);
    }
  });

  function firstRow<T>(rows: T[] | undefined): T | undefined {
    return rows?.[0];
  }

  async function deleteAgentConflicts(agent: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query conflicts($agent: string) {
          conflicts(func: type(FactConflict)) @cascade {
            uid
            FactConflict.old_fact @filter(eq(Fact.agent_id, $agent)) { uid }
          }
        }`,
        { $agent: agent },
      );
      const uids: string[] = (
        (res.data as { conflicts?: { uid: string }[] }).conflicts ?? []
      ).map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      return;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  it("invalidates the prior fact and records a FactConflict for a near-duplicate embedding", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    const basis = (index: number): number[] => {
      const vector = new Array(768).fill(0);

      vector[index] = 1;

      return vector;
    };
    const distinctiveVec = basis(517);

    try {
      const first = await store.persistFact({
        text: "CI uses GitHub Actions",
        agentId: agent,
        embedding: distinctiveVec,
      });

      await store.persistFact({
        text: "CI runs on GitHub Actions runners",
        agentId: agent,
        embedding: distinctiveVec,
      });

      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(
          `query check($agent: string, $xid: string) {
            firstFact(func: eq(Fact.xid, $xid)) {
              uid
              Fact.active
              ~FactConflict.old_fact {
                FactConflict.similarity
              }
            }
          }`,
          { $agent: agent, $xid: first.id },
        );
        const rows = (res.data as { firstFact?: Record<string, any>[] })
          .firstFact;
        const firstFact = firstRow(rows);
        const conflicts = firstFact?.["~FactConflict.old_fact"];

        expect(firstFact?.["Fact.active"]).toBe(false);
        expect(conflicts).toContainEqual(
          expect.objectContaining({
            "FactConflict.similarity": expect.any(Number),
          }),
        );
        expect(
          firstRow<Record<string, any>>(conflicts)?.["FactConflict.similarity"],
        ).toBeGreaterThanOrEqual(0.92);
      } finally {
        await txn.discard().catch(() => {});
      }
    } finally {
      await deleteAgentConflicts(agent);
      await deleteAgentFacts(agent);
    }
  });

  it("returns the stored value at version 1 after writeMemory then readMemory of a new key", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.writeMemory({
        key: "kernel-key",
        value: "hello",
        agentId: agent,
      });
      const got = await store.readMemory("kernel-key", agent);

      expect(got).toMatchObject({
        key: "kernel-key",
        value: "hello",
        version: 1,
      });
    } finally {
      await deleteAgentNodes(agent);
    }
  });

  it("returns version 2 and the latest value after writing the same key twice", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.writeMemory({ key: "k", value: "v1", agentId: agent });
      const secondWrite = await store.writeMemory({
        key: "k",
        value: "v2",
        agentId: agent,
      });
      const got = await store.readMemory("k", agent);

      expect(secondWrite).toMatchObject({ version: 2 });
      expect(got).toMatchObject({ key: "k", value: "v2", version: 2 });
    } finally {
      await deleteAgentNodes(agent);
    }
  });

  it("excludes a memory whose expires_at is in the past", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.writeMemory({
        key: "expired-key",
        value: "stale",
        agentId: agent,
      });

      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(
          `query node($agent: string) { node(func: eq(Memory.agent_id, $agent)) { uid } }`,
          { $agent: agent },
        );
        const uid = (res.data as { node?: { uid: string }[] }).node?.[0]?.uid;
        const pastIso = new Date(Date.now() - 60_000).toISOString();

        await txn.mutate({
          setJson: { uid, "Memory.expires_at": pastIso },
          commitNow: true,
        });
      } finally {
        await txn.discard().catch(() => {});
      }

      expect(await store.readMemory("expired-key", agent)).toBeFalsy();
    } finally {
      await deleteAgentNodes(agent);
    }
  });

  it("soft-deletes so readMemory returns nothing", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.writeMemory({ key: "del-key", value: "x", agentId: agent });
      const res = await store.deleteMemory("del-key", agent);

      expect(res).toEqual({ key: "del-key", deleted: true });
      expect(await store.readMemory("del-key", agent)).toBeFalsy();
    } finally {
      await deleteAgentNodes(agent);
    }
  });

  it("returns total 2 and the two live keys, excluding the soft-deleted one", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.writeMemory({ key: "a", value: "1", agentId: agent });
      await store.writeMemory({ key: "b", value: "2", agentId: agent });
      await store.writeMemory({ key: "gone", value: "3", agentId: agent });
      await store.deleteMemory("gone", agent);

      const out = await store.listMemories({ agentId: agent });

      expect(out.total).toBe(2);
      expect(out.memories.map((memory) => memory.key).sort()).toEqual([
        "a",
        "b",
      ]);
    } finally {
      await deleteAgentNodes(agent);
    }
  });

  it("searchMemories returns the memory whose value matches the keyword query", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.writeMemory({
        key: "doc1",
        value: "postgres schema drift outage",
        agentId: agent,
      });

      const results = await store.searchMemories("schema drift", {
        agentId: agent,
      });

      expect(results).toContainEqual(
        expect.objectContaining({
          key: "doc1",
          value: "postgres schema drift outage",
          source: "memory",
        }),
      );
    } finally {
      await deleteAgentNodes(agent);
    }
  });

  it("searchMemories returns the vector-nearest memory when the keyword query matches nothing", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    const basis = (index: number): number[] => {
      const vector = new Array(768).fill(0);

      vector[index] = 1;

      return vector;
    };
    const embeddingA = basis(0);
    const embeddingB = basis(1);
    const queryVec = basis(0);

    try {
      await store.writeMemory({
        key: "vecA",
        value: "alpha",
        agentId: agent,
        embedding: embeddingA,
      });
      await store.writeMemory({
        key: "vecB",
        value: "beta",
        agentId: agent,
        embedding: embeddingB,
      });

      const results = await store.searchMemories("zzznomatch", {
        agentId: agent,
        embedding: queryVec,
      });

      expect(results).toContainEqual(
        expect.objectContaining({ key: "vecA", source: "memory" }),
      );
    } finally {
      await deleteAgentNodes(agent);
    }
  });

  async function deleteAgentEpisodes(agent: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($agent: string) { nodes(func: eq(Episode.agent_id, $agent)) { uid } }`,
        { $agent: agent },
      );
      const uids: string[] = (
        (res.data as { nodes?: { uid: string }[] }).nodes ?? []
      ).map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      return;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  it("writeEpisode of identical content twice creates exactly one Episode node", async () => {
    const agent = `dgraph-ms-test-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      const first = await store.writeEpisode({
        content: "the deploy ran at 3pm",
        agentId: agent,
        source: "conversation",
      });
      const second = await store.writeEpisode({
        content: "the deploy ran at 3pm",
        agentId: agent,
        source: "conversation",
      });

      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(
          `query q($agent: string) {
            q(func: eq(Episode.agent_id, $agent)) { uid Episode.content }
          }`,
          { $agent: agent },
        );
        const episodes = (res.data as { q?: Record<string, any>[] }).q ?? [];

        expect(episodes.length).toBe(1);
      } finally {
        await txn.discard().catch(() => {});
      }

      expect(second.id).toBe(first.id);
    } finally {
      await deleteAgentEpisodes(agent);
    }
  });

  async function deleteGraphForEntities(names: string[]): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const uids = new Set<string>();

      const entityAndRelUids = async (name: string): Promise<string[]> => {
        const res = await txn.queryWithVars(
          `query q($name: string) {
            q(func: eq(Entity.name, $name)) {
              uid
              Entity.out_rels { uid }
              Entity.in_rels { uid }
            }
          }`,
          { $name: name },
        );
        const entities = (res.data as { q?: Record<string, any>[] }).q ?? [];

        return entities.flatMap((entity) => [
          entity.uid,
          ...(entity["Entity.out_rels"] ?? []).map(
            (rel: { uid: string }) => rel.uid,
          ),
          ...(entity["Entity.in_rels"] ?? []).map(
            (rel: { uid: string }) => rel.uid,
          ),
        ]);
      };

      for (const name of names) {
        const found = await entityAndRelUids(name);

        found.forEach((uid) => uids.add(uid));
      }

      if (uids.size) {
        await txn.mutate({
          deleteNquads: [...uids].map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      return;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  it("upsertEdge creates an active GraphRel of the given relation_type from source to target", async () => {
    const source = `ent-a-${randomUUID()}`;
    const target = `ent-b-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.upsertEdge({ source, target, relationType: "uses" });

      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(
          `query g($a: string) {
            ent(func: eq(Entity.name, $a)) {
              Entity.out_rels {
                GraphRel.relation_type
                GraphRel.active
                GraphRel.target { Entity.name }
              }
            }
          }`,
          { $a: source },
        );
        const rels =
          (res.data as { ent?: Record<string, any>[] }).ent?.[0]?.[
            "Entity.out_rels"
          ] ?? [];

        expect(rels).toContainEqual(
          expect.objectContaining({
            "GraphRel.relation_type": "uses",
            "GraphRel.active": true,
            "GraphRel.target": expect.objectContaining({
              "Entity.name": target,
            }),
          }),
        );
      } finally {
        await txn.discard().catch(() => {});
      }
    } finally {
      await deleteGraphForEntities([source, target]);
    }
  });

  it("invalidates the prior edge when a same-source same-relation edge points at a different target", async () => {
    const a = `ent-a-${randomUUID()}`;
    const b = `ent-b-${randomUUID()}`;
    const c = `ent-c-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.upsertEdge({ source: a, target: b, relationType: "uses" });
      await store.upsertEdge({ source: a, target: c, relationType: "uses" });

      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(
          `query g($a: string) {
            ent(func: eq(Entity.name, $a)) {
              Entity.out_rels {
                GraphRel.active
                GraphRel.target { Entity.name }
              }
            }
          }`,
          { $a: a },
        );
        const rels =
          (res.data as { ent?: Record<string, any>[] }).ent?.[0]?.[
            "Entity.out_rels"
          ] ?? [];
        const activeByTarget = Object.fromEntries(
          rels.map((rel: Record<string, any>) => [
            rel["GraphRel.target"]?.["Entity.name"],
            rel["GraphRel.active"],
          ]),
        );

        expect({ [b]: activeByTarget[b], [c]: activeByTarget[c] }).toEqual({
          [b]: false,
          [c]: true,
        });
      } finally {
        await txn.discard().catch(() => {});
      }
    } finally {
      await deleteGraphForEntities([a, b, c]);
    }
  });

  it("queryGraph returns the 1-hop outgoing neighbour as a hop at depth 1", async () => {
    const a = `ent-a-${randomUUID()}`;
    const b = `ent-b-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.upsertEdge({ source: a, target: b, relationType: "uses" });

      const hops = await store.queryGraph(a, 1);

      expect(hops).toContainEqual(
        expect.objectContaining({
          entity: a,
          relation: "uses",
          related_entity: b,
          direction: "outgoing",
          depth: 1,
        }),
      );
    } finally {
      await deleteGraphForEntities([a, b]);
    }
  });

  it("traverses two hops so A--uses-->B--hosts-->C yields the depth-2 hop B--hosts-->C", async () => {
    const a = `ent-a-${randomUUID()}`;
    const b = `ent-b-${randomUUID()}`;
    const c = `ent-c-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.upsertEdge({ source: a, target: b, relationType: "uses" });
      await store.upsertEdge({ source: b, target: c, relationType: "hosts" });

      const hops = await store.queryGraph(a, 2);

      expect(hops).toContainEqual(
        expect.objectContaining({
          entity: b,
          relation: "hosts",
          related_entity: c,
          direction: "outgoing",
          depth: 2,
        }),
      );
    } finally {
      await deleteGraphForEntities([a, b, c]);
    }
  });

  it("excludes an invalidated (active=false) edge from traversal by default", async () => {
    const a = `ent-a-${randomUUID()}`;
    const b = `ent-b-${randomUUID()}`;
    const c = `ent-c-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.upsertEdge({ source: a, target: b, relationType: "uses" });
      await store.upsertEdge({ source: a, target: c, relationType: "uses" });

      const targets = (await store.queryGraph(a, 1)).map(
        (hop) => hop.related_entity,
      );

      expect(targets).toContain(c);
      expect(targets).not.toContain(b);
    } finally {
      await deleteGraphForEntities([a, b, c]);
    }
  });

  it("terminates on a cycle A--links-->B--links-->A without infinite recursion", async () => {
    const a = `ent-a-${randomUUID()}`;
    const b = `ent-b-${randomUUID()}`;
    const store = new DgraphMemoryStore(dgraphClient);

    try {
      await store.upsertEdge({ source: a, target: b, relationType: "links" });
      await store.upsertEdge({ source: b, target: a, relationType: "links" });

      const hops = await store.queryGraph(a, 3);

      expect(hops).toContainEqual(
        expect.objectContaining({ entity: a, related_entity: b, depth: 1 }),
      );
      expect(hops).toContainEqual(
        expect.objectContaining({ entity: b, related_entity: a, depth: 2 }),
      );
    } finally {
      await deleteGraphForEntities([a, b]);
    }
  });
});
