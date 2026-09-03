/** Who could take a station run BEFORE enqueue and when one dies unclaimed. Pure: the caller reads the registry, this decides what it means. */

import type { ClusterAgent } from "../../models/cluster-agent.js";
import { tagsSatisfy } from "./required-tags.js";

export type CapacityVerdict =
  /** At least one live, un-paused cluster can take it — dispatch. */
  | { kind: "capable"; agents: ClusterAgent[] }
  /** Providers exist but every one is paused or offline — wait for an operator. */
  | { kind: "all-unavailable"; reason: string }
  /** The registry is populated and nobody offers these tags — a config fault. */
  | { kind: "none-registered"; reason: string }
  /** Nobody registered at all; callers FAIL OPEN (boot or registry outage). */
  | { kind: "registry-empty" };

/** Whether an agent may be handed new work: the operator's switch only, not offline status (reaper's view). */
export function mayClaim(agent: Pick<ClusterAgent, "paused">): boolean {
  return !agent.paused;
}

/** Why one matching agent cannot take work: paused wins (operator action) over offline (reaper's view). */
function unavailableBecause(agent: ClusterAgent): string {
  return agent.paused ? "paused" : "offline";
}

export function capacityFor(
  requiredTags: string[],
  agents: ClusterAgent[],
): CapacityVerdict {
  if (agents.length === 0) {
    return { kind: "registry-empty" };
  }
  const providers = agents.filter((agent) =>
    tagsSatisfy(requiredTags, agent.tags),
  );
  const tags = `[${requiredTags.join(", ")}]`;

  if (providers.length === 0) {
    return {
      kind: "none-registered",
      reason: `no registered cluster-agent offers ${tags}`,
    };
  }
  // Predicts who WILL take the work: reaper's offline agents don't count even if claimed later.
  const available = providers.filter(
    (agent) => mayClaim(agent) && agent.status === "active",
  );

  if (available.length > 0) {
    return { kind: "capable", agents: available };
  }
  const named = providers
    .map((agent) => `${agent.name} (${unavailableBecause(agent)})`)
    .join(", ");

  return {
    kind: "all-unavailable",
    reason: `every cluster-agent offering ${tags} is unavailable: ${named}`,
  };
}

/** The detail a queue-timeout records: one writer for both reaper arms. */
export function unclaimedDetail(input: {
  requiredTags: string[];
  waitMinutes: number;
  verdict: CapacityVerdict;
}): string {
  const opening = `no cluster-agent claimed this run (required_tags: [${input.requiredTags.join(", ")}]) within ${input.waitMinutes}m`;

  return `${opening} — ${becauseOf(input.verdict)}`;
}

function becauseOf(verdict: CapacityVerdict): string {
  switch (verdict.kind) {
    case "registry-empty":
      return "no cluster-agent has ever registered";
    case "none-registered":
    case "all-unavailable":
      return verdict.reason;
    case "capable": {
      // A cluster that could have taken it, was up, and did not — distinguishes operator action from wedged.
      const names = verdict.agents.map((agent) => agent.name).join(", ");
      const count = verdict.agents.length;
      const noun = count === 1 ? "cluster-agent" : "cluster-agents";
      const verb = count === 1 ? "was" : "were";
      const they = count === 1 ? "it" : "they";

      return `${count} capable ${noun} (${names}) ${verb} active but did not claim it; ${they} may be wedged`;
    }
  }
}
