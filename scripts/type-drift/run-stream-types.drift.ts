/**
 * Compile-time drift guard for the agent-run-event mirror.
 *
 * apps/web-ui CANNOT import @re-cinq/lore-shared — it is excluded from the npm
 * workspace and built in an isolated Docker context — so the canonical
 * AgentRunEventRow is hand-mirrored in apps/web-ui/src/lib/run-stream-types.ts.
 *
 * This file makes that mirror's drift a hard failure: `npm run typecheck:drift`
 * (tsc --noEmit) goes red the moment the canonical row gains a key, or the event
 * type union gains a member, that the mirror lacks. It is type-only (everything
 * erases) and is NEVER bundled into the web app.
 *
 * The guard is KEYS-ONLY, deliberately. The two types cannot be structurally
 * equal: `createdAt` is a `Date` on the port and a `string` on the mirror,
 * because the mirror only ever sees the JSON projection of the row. A
 * structural-equality guard would be red on arrival for a difference that is
 * correct.
 */

import type {
  AgentRunEventRow as CanonRow,
  AgentRunEventType as CanonEventType,
} from "../../libs/shared/src/project/agent-run-events/agent-run-events-port.js";

import type {
  RunStreamEvent as MirrorRow,
  AgentRunEventType as MirrorEventType,
} from "../../apps/web-ui/src/lib/run-stream-types.js";

// Every canonical key must exist on the mirror (extra keys on the mirror are
// fine). Resolves to `true` on success, else to an error object that `= true` rejects.
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
