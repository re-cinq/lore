/** spec-traceability-graph — shared, facet-agnostic Dgraph upsert primitives (withTxn/newUid/upsertByXid); extracted from project-spec-file.ts once ingest-coverage.ts needed them too. Mirrors dgraph-memory-store.ts's idiom; talks only to {@link DgraphClientPort}. */

import type { DgraphClientPort, DgraphTxn } from "./deps.js";
import { withBackoff } from "../lib/backoff.js";

/** Node types in the spec-traceability graph, all upserted by xid through {@link upsertByXid}. */
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

/** True for dgraph's abort/conflict errors — the driver normalizes both into one plain-Error message, so this mirrors its own `isAbortedError` (message carries "abort" + "retry"). */
export function isTxnAborted(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const message = err.message.toLowerCase();

  return message.includes("abort") && message.includes("retry");
}

/** Full-jitter retry delays for txn aborts — a deterministic schedule made ~50 concurrently-fanned-out pods re-collide at exactly 200/500/1000ms until retries ran out (2026-08-10); worst case ~7.7s, still well under the 600s reaper timeout. */
export const TXN_ABORT_DELAYS_MS: readonly number[] = [
  200, 500, 1000, 2000, 4000,
];

/** Runs `fn` in a fresh, always-discarded txn; an aborted attempt retries on a NEW txn per TXN_ABORT_DELAYS_MS — safe since every spec-trace write is an idempotent xid upsert. Other errors rethrow immediately. */
export async function withTxn<T>(
  dgraph: DgraphClientPort,
  fn: (txn: DgraphTxn) => Promise<T>,
  opts?: { sleep?: (ms: number) => Promise<void>; random?: () => number },
): Promise<T> {
  const random = opts?.random ?? Math.random;

  return withBackoff(
    async () => {
      const txn = dgraph.newTxn();

      try {
        return await fn(txn);
      } finally {
        await txn.discard().catch(() => {});
      }
    },
    {
      delaysMs: TXN_ABORT_DELAYS_MS.map((ms) => Math.round(random() * ms)),
      retryOn: isTxnAborted,
      sleep: opts?.sleep,
    },
  );
}

/** Extracts the assigned uid of a blank node from a commitNow mutation result. */
export function newUid(mutateResult: unknown, label: string): string {
  return (mutateResult as { data?: { uids?: Record<string, string> } }).data
    ?.uids?.[label] as string;
}

/** Dgraph corrupts empty-string scalars sent via JSON `set` (stored as literal `"[]"`); they round-trip correctly only via N-Quads, so split them out for a dedicated N-Quads write. */
function splitEmptyStringFields(fields: Record<string, unknown>): {
  jsonFields: Record<string, unknown>;
  emptyStringPredicates: string[];
} {
  const jsonFields: Record<string, unknown> = {};
  const emptyStringPredicates: string[] = [];

  for (const [predicate, value] of Object.entries(fields)) {
    if (value === "") {
      emptyStringPredicates.push(predicate);
      continue;
    }
    jsonFields[predicate] = value;
  }

  return { jsonFields, emptyStringPredicates };
}

/** Writes each predicate's value as an empty string via N-Quads — the only representation Dgraph round-trips an empty scalar through (see {@link splitEmptyStringFields}). */
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

/** Removes a predicate entirely via `<uid> <pred> * .` — the clean way to clear a scalar, since a JSON `set` of `""` would corrupt it to `"[]"` (see {@link splitEmptyStringFields}). */
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

/** Replaces all of a node's `[uid]` edges on `predicate` with `targetUids` — delete-then-set, so the predicate holds exactly the new set rather than Dgraph's plain-`setJson` union. */
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

/** Like {@link replaceEdge}, but each target carries scalar facets written as `predicate|key` pairs — used for `Coverage.covers|ranges`. Delete-then-set so re-ingest mirrors the latest set. */
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

/** Upserts a node identified by its `<Type>.xid` predicate: reuses the existing uid if present, else creates a fresh blank node; `fields` applied in both branches. */
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
