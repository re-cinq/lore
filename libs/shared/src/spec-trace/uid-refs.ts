/** Small UidRef-array helpers shared by the whole-file subtree pruners (prune-removed-docs.ts, prune-adr-subtree.ts). */

import type { UidRef } from "./deps.js";

export const uids = (refs: UidRef[] | undefined): string[] =>
  (refs ?? []).map((ref) => ref.uid);

export function firstOf<T>(rows: T[] | undefined): T | undefined {
  return (rows ?? [])[0];
}
