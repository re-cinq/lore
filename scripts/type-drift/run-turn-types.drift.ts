/**
 * Compile-time drift guard for the agent-run-turn mirror.
 *
 * apps/web-ui CANNOT import @re-cinq/lore-shared — it is excluded from the npm
 * workspace and built in an isolated Docker context — so the canonical
 * AgentRunTurnRow is hand-mirrored in apps/web-ui/src/lib/run-turn-types.ts.
 *
 * This file makes that mirror's drift a hard failure: `npm run typecheck:drift`
 * (tsc --noEmit) goes red the moment the canonical row gains a key the mirror
 * lacks. It is type-only (everything erases) and is NEVER bundled into the web
 * app.
 *
 * The guard is KEYS-ONLY, deliberately, for the same reason as the sibling
 * run-stream-types guard: `createdAt` is a `Date` on the port and a `string` on
 * the mirror, because the mirror only ever sees the JSON projection of the row.
 * A structural-equality guard would be red on arrival for a difference that is
 * correct.
 */

import type { AgentRunTurnRow as CanonRow } from "../../libs/shared/src/project/agent-run-turns/agent-run-turns-port.js";

import type { AgentRunTurn as MirrorRow } from "../../apps/web-ui/src/lib/run-turn-types.js";

// Every canonical key must exist on the mirror (extra keys on the mirror are
// fine). Resolves to `true` on success, else to an error object that `= true` rejects.
type KeysCovered<Canon, Mirror> = keyof Canon extends keyof Mirror
  ? true
  : { MIRROR_MISSING_KEYS: Exclude<keyof Canon, keyof Mirror> };

export const _agentRunTurnRow: KeysCovered<CanonRow, MirrorRow> = true;
