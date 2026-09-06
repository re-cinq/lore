import { randomUUID } from "node:crypto";
import type { DgraphClientPort } from "./memory-store.js";
import { newUid } from "./dgraph-vector.js";
import { withTxn } from "./dgraph-txn.js";
import { flattenHops, type GraphHop } from "./dgraph-graph-hops.js";

async function upsertEntity(
  client: DgraphClientPort,
  name: string,
  entityType: string,
  repo: string,
): Promise<string> {
  const dedupKey = `${name}|${entityType}|${repo}`;

  return withTxn(client, async (txn) => {
    const res = await txn.queryWithVars(
      `query e($dk: string) { found(func: eq(Entity.dedup_key, $dk), first: 1) { uid } }`,
      { $dk: dedupKey },
    );
    const found = res.data.found?.[0];

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

/** Postgres-parity contradiction detection for graph edges: the source's active edges of this relation pointing at a different target (an exact-duplicate target is left untouched). */
async function findContradictedRels(
  client: DgraphClientPort,
  sourceUid: string,
  relationType: string,
  targetUid: string,
): Promise<string[]> {
  return withTxn(client, async (txn) => {
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
    const rels = (res.data.contradictions?.[0]?.["Entity.out_rels"] ??
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

export async function upsertEdge(
  client: DgraphClientPort,
  input: {
    source: string;
    target: string;
    relationType: string;
    entityType?: string;
    repo?: string;
  },
): Promise<void> {
  const entityType = input.entityType ?? "";
  const repo = input.repo ?? "";
  const sourceUid = await upsertEntity(client, input.source, entityType, repo);
  const targetUid = await upsertEntity(client, input.target, entityType, repo);
  const now = new Date().toISOString();

  const contradictedUids = await findContradictedRels(
    client,
    sourceUid,
    input.relationType,
    targetUid,
  );

  const invalidations = contradictedUids.map((relUid) => ({
    uid: relUid,
    "GraphRel.active": false,
    "GraphRel.valid_to": now,
  }));

  await withTxn(client, (txn) =>
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

export async function queryGraph(
  client: DgraphClientPort,
  entityName: string,
  depth: number,
): Promise<GraphHop[]> {
  if (!Number.isInteger(depth) || depth < 1) {
    return [];
  }

  // `@recurse(depth: N)` counts PREDICATE levels (3 per graph hop), so `depth` graph hops needs 2*depth+1 levels; `depth` is a validated integer, safe to inline.
  const levels = depth * 2 + 1;

  return withTxn(client, async (txn) => {
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
    const root = (res.data.result ?? [])[0] as
      Record<string, unknown> | undefined;

    if (!root) {
      return [];
    }

    return flattenHops(root, depth);
  });
}
