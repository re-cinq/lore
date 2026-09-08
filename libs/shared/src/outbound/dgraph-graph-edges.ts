import { randomUUID } from "node:crypto";
import type { DgraphClientPort } from "./memory-store.js";
import { newUid } from "./dgraph-vector.js";
import { withTxn } from "./dgraph-txn.js";
import { flattenHops, type GraphHop } from "./dgraph-graph-hops.js";
import { firstOf } from "../lib/row.js";

/** A fresh Entity. The dedup key is stored alongside its three parts because identity here is the COMBINATION — the same name under a different type, or in a different repo, is a different thing. */
function newEntity({
  name,
  entityType,
  repo,
  dedupKey,
}: {
  name: string;
  entityType: string;
  repo: string;
  dedupKey: string;
}): Record<string, unknown> {
  const now = new Date().toISOString();

  return {
    uid: "_:ent",
    "dgraph.type": "Entity",
    "Entity.xid": randomUUID(),
    "Entity.name": name,
    "Entity.entity_type": entityType,
    "Entity.repo": repo,
    "Entity.dedup_key": dedupKey,
    "Entity.created_at": now,
    "Entity.updated_at": now,
  };
}

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
    const found = firstOf(res.data.found);

    if (found) {
      return found.uid as string;
    }

    const created = await txn.mutate({
      setJson: newEntity({ name, entityType, repo, dedupKey }),
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
    const rels = (firstOf(res.data.contradictions)?.["Entity.out_rels"] ??
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

/** Closes an edge by TIME rather than deleting it: the graph is temporal, and "this was true until now" is the answer a historical query needs. */
function closeEdge(relUid: string, now: string) {
  return {
    uid: relUid,
    "GraphRel.active": false,
    "GraphRel.valid_to": now,
  };
}

/** The new edge, hung off the source entity so one mutation creates both the relationship and its back-reference. */
function openEdge(
  edge: { sourceUid: string; targetUid: string; relationType: string },
  now: string,
) {
  return {
    uid: edge.sourceUid,
    "Entity.out_rels": {
      uid: "_:rel",
      "dgraph.type": "GraphRel",
      "GraphRel.xid": randomUUID(),
      "GraphRel.relation_type": edge.relationType,
      "GraphRel.active": true,
      "GraphRel.valid_from": now,
      "GraphRel.created_at": now,
      "GraphRel.source": { uid: edge.sourceUid },
      "GraphRel.target": { uid: edge.targetUid },
    },
  };
}

interface EdgeInput {
  source: string;
  target: string;
  relationType: string;
  entityType?: string;
  repo?: string;
}

/** Both endpoints, created if this is the first time either has been named. Entity type and repo default to empty rather than being required: an edge extracted from prose often knows the two names and nothing else, and refusing it would lose the relationship entirely. */
async function endpointUids(
  client: DgraphClientPort,
  input: EdgeInput,
): Promise<[string, string]> {
  const entityType = input.entityType ?? "";
  const repo = input.repo ?? "";

  return Promise.all([
    upsertEntity(client, input.source, entityType, repo),
    upsertEntity(client, input.target, entityType, repo),
  ]);
}

export async function upsertEdge(
  client: DgraphClientPort,
  input: EdgeInput,
): Promise<void> {
  const [sourceUid, targetUid] = await endpointUids(client, input);
  const now = new Date().toISOString();
  const contradicted = await findContradictedRels(
    client,
    sourceUid,
    input.relationType,
    targetUid,
  );

  // ONE transaction: the contradicted edges are closed and the new one opened together, or a reader between the two writes sees the relationship twice — or not at all.
  await withTxn(client, (txn) =>
    txn.mutate({
      setJson: [
        ...contradicted.map((relUid) => closeEdge(relUid, now)),
        openEdge(
          { sourceUid, targetUid, relationType: input.relationType },
          now,
        ),
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
