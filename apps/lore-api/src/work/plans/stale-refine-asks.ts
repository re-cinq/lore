// A Refine the editor marked as asked, which no agent ever took up, blocks every other section's Refine for good: the page that asked can die before it hears lore-api fail, and only that page would withdraw it. lore-api answers such an ask as failed when the plan is opened again.

import type { RefineProposal } from "@re-cinq/planning-document";

/** How long an ask may wait for the floor to open the agent's visit before it counts as never started. */
export const STALE_ASK_MS = 5 * 60_000;

export const NEVER_STARTED =
  "the agent never started on this Refine, since the request did not reach it; Refine again";

export interface StalePlan {
  id: string;
  repo: string;
}

export interface StaleAskDeps {
  /** The plan's Refine asks as its live document holds them. */
  asks(plan: StalePlan): Promise<RefineProposal[]>;
  /** Whether a pass of the planning line holds the plan now. */
  agentWorking(plan: StalePlan): Promise<boolean>;
  failRefine(request: {
    planId: string;
    slot: string;
    reason: string;
  }): Promise<unknown>;
}

/** The sections whose ask has waited past the grace with no answer. */
export function staleAskSlots(
  proposals: readonly RefineProposal[],
  now: Date,
): string[] {
  return proposals
    .filter((proposal) => proposal.status === "asked")
    .filter(
      (proposal) => now.getTime() - Date.parse(proposal.askedAt) > STALE_ASK_MS,
    )
    .map((proposal) => proposal.slot);
}

/** Fails every stale ask of a plan no agent is working on; an ask an agent may still be answering is left. The slots it failed. */
export async function clearStaleAsks(
  deps: StaleAskDeps,
  plan: StalePlan,
  now: Date,
): Promise<string[]> {
  const slots = staleAskSlots(await deps.asks(plan), now);

  if (slots.length === 0 || (await deps.agentWorking(plan))) {
    return [];
  }
  await Promise.all(
    slots.map((slot) =>
      deps.failRefine({ planId: plan.id, slot, reason: NEVER_STARTED }),
    ),
  );

  return slots;
}
