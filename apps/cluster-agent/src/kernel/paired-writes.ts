// The read-modify-write pairs, kept whole on this side of the network.
//
// They are here rather than inline in `deps.ts` because they are DECISIONS —
// a retry ladder, a write order — and `deps.ts` is an IO shell excluded from
// coverage. Both of these shipped with a defect while they lived there: no
// conflict retry on the status patch, and a catalog apply written in the order
// its own sibling's comment argued against. Decision logic in an IO shell is
// decision logic nobody tests.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { agentsNamespace, preserveUnownedFields } from "@re-cinq/lore-shared";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { describeK8sError, isConflict } from "./k8s-errors.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";

/** Retries of the status read-modify-write before a conflict is a real failure.
 *  Matches the Secret writer's ladder; a status this contended is a bug, not a
 *  race to keep losing. */
const MAX_STATUS_CONFLICTS = 4;

/** The Agent status read-modify-write, retried on conflict.
 *
 *  Extracted from the deps object so it is reachable by a test holding a fake
 *  client. Keeping the pair whole prevents a CALLER from splitting it across
 *  the network; it does not prevent the ai-agent controller from writing
 *  `status.phase` between these two calls. Without the retry that collision
 *  throws, and every caller of this swallows. Same ladder as the Secret writer
 *  in `kube-token-provisioner.ts`, for the same reason.
 */
export async function patchAgentStatus(
  co: StatusClient,
  name: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const args = {
    group: GROUP,
    version: VERSION,
    namespace: agentsNamespace(),
    plural: PLURAL,
    name,
  };

  for (let attempt = 0; ; attempt++) {
    const current = (await co.getNamespacedCustomObjectStatus(args)) as {
      status?: Record<string, unknown>;
      [k: string]: unknown;
    };

    try {
      await co.replaceNamespacedCustomObjectStatus({
        ...args,
        body: { ...current, status: { ...current.status, ...patch } },
      });

      return;
    } catch (err) {
      // Re-read on conflict: the loser of the race merges its patch onto the
      // winner's status rather than overwriting it.
      enforceTrue(
        isConflict(err) && attempt < MAX_STATUS_CONFLICTS,
        Error,
        describeK8sError("patch status of", name, err),
      );
    }
  }
}

/** The two calls a status patch makes; a test fakes exactly this. */
export interface StatusClient {
  getNamespacedCustomObjectStatus(args: object): Promise<unknown>;
  replaceNamespacedCustomObjectStatus(args: object): Promise<unknown>;
}

/** The catalog half of a recipe, applied Station FIRST.
 *
 *  The mirror of `deletePair`: the AgentDefinition is what a dispatch looks up,
 *  so writing it LAST means a recipe is never visible pointing at a station
 *  that does not exist yet. Applying them the other way round opens exactly
 *  that window, and `deletePair` already said so about its own order.
 */
export async function applyCatalogPair(
  catalog: CatalogWriter,
  {
    agentDefinition,
    station,
  }: { agentDefinition: AgentDefinition; station: Station },
): Promise<void> {
  await catalog.applyStation(
    mergeOntoLive(await catalog.getStation(station.metadata!.name!), station),
  );
  await catalog.applyAgentDefinition(
    mergeOntoLive(
      await catalog.getAgentDefinition(agentDefinition.metadata!.name!),
      agentDefinition,
    ),
  );
}

/** The four catalog calls an apply makes. `metadata.name` is guaranteed by the
 *  route's schema, which is why the assertions above are safe. */
export interface CatalogWriter {
  getStation(name: string): Promise<Station | null>;
  getAgentDefinition(name: string): Promise<AgentDefinition | null>;
  applyStation(station: Station): Promise<void>;
  applyAgentDefinition(def: AgentDefinition): Promise<void>;
}

function mergeOntoLive<T extends AgentDefinition | Station>(
  live: unknown,
  desired: T,
): T {
  return live ? preserveUnownedFields(live, desired) : desired;
}
