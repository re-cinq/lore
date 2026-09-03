// Drift guard: web-ui can't import @re-cinq/lore-shared, so AgentRunTurnRow is hand-mirrored; keys-only since createdAt is Date on the port but string (JSON) on the mirror.

import type { AgentRunTurnRow as CanonRow } from "../../libs/shared/src/project/agent-run-turns/agent-run-turns-port.js";

import type { AgentRunTurn as MirrorRow } from "../../apps/web-ui/src/lib/run-turn-types.js";

// Every canonical key must exist on the mirror; resolves to true on success, else an error object that "= true" rejects.
type KeysCovered<Canon, Mirror> = keyof Canon extends keyof Mirror
  ? true
  : { MIRROR_MISSING_KEYS: Exclude<keyof Canon, keyof Mirror> };

export const _agentRunTurnRow: KeysCovered<CanonRow, MirrorRow> = true;
