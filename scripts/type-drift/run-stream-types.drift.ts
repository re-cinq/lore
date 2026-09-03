// Drift guard: web-ui can't import @re-cinq/lore-shared, so AgentRunEventRow is hand-mirrored; keys-only since createdAt is Date on the port but string (JSON) on the mirror.

import type {
  AgentRunEventRow as CanonRow,
  AgentRunEventType as CanonEventType,
} from "../../libs/shared/src/project/agent-run-events/agent-run-events-port.js";

import type {
  RunStreamEvent as MirrorRow,
  AgentRunEventType as MirrorEventType,
} from "../../apps/web-ui/src/lib/run-stream-types.js";

// Every canonical key must exist on the mirror; resolves to true on success, else an error object that "= true" rejects.
type KeysCovered<Canon, Mirror> = keyof Canon extends keyof Mirror
  ? true
  : { MIRROR_MISSING_KEYS: Exclude<keyof Canon, keyof Mirror> };

// Unions must match exactly, in both directions.
type UnionEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : { UNION_MIRROR_HAS_EXTRA: Exclude<B, A> }
  : { UNION_MIRROR_IS_MISSING: Exclude<A, B> };

export const _agentRunEventRow: KeysCovered<CanonRow, MirrorRow> = true;
export const _agentRunEventType: UnionEqual<CanonEventType, MirrorEventType> =
  true;
