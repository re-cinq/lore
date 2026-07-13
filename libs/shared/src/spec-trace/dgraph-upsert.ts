/**
 * spec-traceability-graph — shared Dgraph upsert primitives.
 *
 * The generic, facet-agnostic building blocks every spec-trace writer needs:
 *   - {@link withTxn}     — run a unit of work in a fresh, always-discarded txn,
 *   - {@link newUid}      — pull the assigned uid of a blank node out of a result,
 *   - {@link upsertByXid} — idempotent create-or-update keyed on `<Type>.xid`.
 *
 * Extracted from `project-spec-file.ts` once a second consumer
 * (`ingest-coverage.ts`) appeared, so the upsert idiom has a single home. The
 * projection-specific projectors (projectSections, projectStatement,
 * pruneOrphans, …) stay with their facet; only these primitives live here.
 *
 * Mirrors the canonical `withTxn`/`newUid`/`upsertEntity` idiom in
 * `shared/src/dgraph-memory-store.ts`. Talks only to the injected
 * {@link DgraphClientPort}; never imports the driver.
 */

import type { DgraphClientPort, DgraphTxn } from "./deps.js";

/**
 * Node types in the spec-traceability graph, all upserted by xid through
 * {@link upsertByXid}: the Phase 1 projection writes Repo, Spec, Section,
 * Statement, TestChunk, CodeChunk, and AcceptanceCriterion; Phase 3 coverage
 * ingest adds Coverage.
 */
export type SpecTraceNodeType =
  | "Repo"
  | "Spec"
  | "ADR"
  | "Section"
  | "Statement"
  | "TestChunk"
  | "TestSuite"
  | "CodeChunk"
  | "AcceptanceCriterion"
  | "Block"
  | "Coverage"
  | "File"
  | "Feature"
  | "TraceLink";

/** Runs `fn` inside a fresh transaction, always discarding it afterwards. */
export async function withTxn<T>(
  dgraph: DgraphClientPort,
  fn: (txn: DgraphTxn) => Promise<T>,
): Promise<T> {
  const txn = dgraph.newTxn();

  try {
    return await fn(txn);
  } finally {
    await txn.discard().catch(() => {});
  }
}

/** Extracts the assigned uid of a blank node from a commitNow mutation result. */
export function newUid(mutateResult: unknown, label: string): string {
  return (mutateResult as { data?: { uids?: Record<string, string> } }).data
    ?.uids?.[label] as string;
}

/**
 * Dgraph mishandles empty-string scalar values sent through a JSON `set`
 * mutation: `""` is stored verbatim as the two-character literal `"[]"`. Empty
 * strings round-trip correctly only via N-Quads, so we split them out of the
 * JSON payload and write them with a dedicated N-Quads set keyed on the node's
 * uid. (A blank source block carries `Block.text: ""`, the first predicate that
 * exercises this path.)
 */
function splitEmptyStringFields(fields: Record<string, unknown>): {
  jsonFields: Record<string, unknown>;
  emptyStringPredicates: string[];
} {
  const jsonFields: Record<string, unknown> = {};
  const emptyStringPredicates: string[] = [];

  for (const [predicate, value] of Object.entries(fields)) {
    if (value === "") {
      emptyStringPredicates.push(predicate);
    } else {
      jsonFields[predicate] = value;
    }
  }

  return { jsonFields, emptyStringPredicates };
}

/**
 * Writes each predicate's value as an empty string via N-Quads — the only
 * representation Dgraph round-trips an empty scalar through (see
 * {@link splitEmptyStringFields} for why JSON `set` corrupts it). The N-Quad
 * value is a hardcoded empty literal `""`, never user text, so no value
 * escaping is needed here. Uses the port's `setNquads` mutation directly.
 */
async function setEmptyStrings(
  dgraph: DgraphClientPort,
  uid: string,
  predicates: string[],
): Promise<void> {
  if (!predicates.length) {
    return;
  }
  await withTxn(dgraph, async (txn) => {
    await txn.mutate({
      setNquads: predicates
        .map((predicate) => `<${uid}> <${predicate}> "" .`)
        .join("\n"),
      commitNow: true,
    });
  });
}

/**
 * Removes a predicate entirely from a node via the `<uid> <pred> * .` N-Quad
 * delete. This is the clean way to clear a scalar: writing `predicate: ""`
 * through a JSON `set` would corrupt the value to `"[]"` (see
 * {@link splitEmptyStringFields}), so a recovered Statement drops its
 * `violation_reason` by deleting the predicate rather than blanking it. The
 * predicate name is a hardcoded graph identifier, never user text, so no value
 * escaping is needed.
 */
export async function deletePredicate(
  dgraph: DgraphClientPort,
  uid: string,
  predicate: string,
): Promise<void> {
  await withTxn(dgraph, async (txn) => {
    await txn.mutate({
      deleteNquads: `<${uid}> <${predicate}> * .`,
      commitNow: true,
    });
  });
}

/**
 * Replaces all of a node's `[uid]` edges on `predicate` with `targetUids` —
 * delete-then-set, so the predicate ends up holding exactly the new set rather
 * than the set-union Dgraph would produce on a plain `setJson`. An empty
 * `targetUids` clears the edge. Used to keep a re-projected Statement's
 * `validated_by`/`implemented_by` in sync when its inline links change (the same
 * shape as ingest-coverage's `Coverage.covers` replacement).
 */
export async function replaceEdge(
  dgraph: DgraphClientPort,
  uid: string,
  predicate: string,
  targetUids: string[],
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      deleteNquads: `<${uid}> <${predicate}> * .`,
      commitNow: true,
    }),
  );

  if (!targetUids.length) {
    return;
  }
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: {
        uid,
        [predicate]: targetUids.map((target) => ({ uid: target })),
      },
      commitNow: true,
    }),
  );
}

/** An edge target carrying scalar facets (Dgraph edge properties) for a `[uid]` predicate. */
export interface FacetedTarget {
  uid: string;
  facets: Record<string, string | number | boolean>;
}

/**
 * Like {@link replaceEdge}, but each target carries scalar facets written as
 * `predicate|key` pairs (Dgraph edge properties). Used to put the covered line
 * intervals on the `Coverage --covers--> File` edge (`Coverage.covers|ranges`).
 * Delete-then-set so re-ingest mirrors the latest set; facets need no schema.
 */
export async function replaceEdgeWithFacets(
  dgraph: DgraphClientPort,
  uid: string,
  predicate: string,
  targets: FacetedTarget[],
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      deleteNquads: `<${uid}> <${predicate}> * .`,
      commitNow: true,
    }),
  );

  if (!targets.length) {
    return;
  }
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: {
        uid,
        [predicate]: targets.map(({ uid: target, facets }) => ({
          uid: target,
          ...Object.fromEntries(
            Object.entries(facets).map(([key, value]) => [
              `${predicate}|${key}`,
              value,
            ]),
          ),
        })),
      },
      commitNow: true,
    }),
  );
}

/**
 * Upserts a node identified by its `<Type>.xid` predicate: reuse the existing
 * uid if the xid is already present, otherwise create a fresh blank node. Extra
 * `fields` are applied in both branches. Returns the node's uid.
 */
export async function upsertByXid(
  dgraph: DgraphClientPort,
  nodeType: SpecTraceNodeType,
  xid: string,
  fields: Record<string, unknown>,
): Promise<string> {
  return withTxn(dgraph, async (txn) => {
    const { jsonFields, emptyStringPredicates } =
      splitEmptyStringFields(fields);
    const res = await txn.queryWithVars(
      `query find($xid: string) { found(func: eq(${nodeType}.xid, $xid), first: 1) { uid } }`,
      { $xid: xid },
    );
    const existing = res.data?.found?.[0]?.uid as string | undefined;

    if (existing) {
      await txn.mutate({
        setJson: { uid: existing, ...jsonFields },
        commitNow: true,
      });
      await setEmptyStrings(dgraph, existing, emptyStringPredicates);

      return existing;
    }
    const label = nodeType.toLowerCase();
    const created = await txn.mutate({
      setJson: {
        uid: `_:${label}`,
        "dgraph.type": nodeType,
        [`${nodeType}.xid`]: xid,
        ...jsonFields,
      },
      commitNow: true,
    });
    const uid = newUid(created, label);

    await setEmptyStrings(dgraph, uid, emptyStringPredicates);

    return uid;
  });
}
