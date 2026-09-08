/** Small UidRef-array helpers shared by the whole-file subtree pruners (prune-removed-docs.ts, prune-adr-subtree.ts). */

import type { UidRef } from "../../outbound/spec-trace/deps.js";

export { firstOf } from "../../lib/row.js";

export const uids = (refs: UidRef[] | undefined): string[] =>
  (refs ?? []).map((ref) => ref.uid);
