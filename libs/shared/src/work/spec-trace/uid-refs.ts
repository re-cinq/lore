/** Small helpers for the uid edges Dgraph answers, shared by the whole-file subtree pruners (prune-removed-docs.ts, prune-adr-subtree.ts) and the stored-state reads that let a re-projection skip what it would not change. */

import type { UidRef } from "../../outbound/spec-trace/deps.js";

export { firstOf } from "../../lib/row.js";

export const uids = (refs: UidRef[] | undefined): string[] =>
  (refs ?? []).map((ref) => ref.uid);

/** An edge's rows as a list: Dgraph answers a single uid edge as an object and a list edge as an array. */
export function edgeRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value as Record<string, unknown>[];
  }

  return value !== null && typeof value === "object"
    ? [value as Record<string, unknown>]
    : [];
}
