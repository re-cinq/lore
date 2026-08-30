/**
 * Who could actually take a station run, asked BEFORE the run is enqueued and
 * again when one dies unclaimed.
 *
 * The queue matches `required_tags <@ agent.tags` and knows nothing else; the
 * registry knows whether the matching cluster is alive and switched on. Neither
 * half alone can answer "why is this not running", which is how one paused
 * `central` — the only holder of seven of the eight node tags — spent two hours
 * and two full implementations per ticket while the reaper reported "no
 * registered cluster-agent claimed this run" about an agent that was registered,
 * heartbeating, and deliberately off (#1648, #1621, #1654).
 *
 * Pure: the caller reads the registry, this decides what the reading means.
 */

import type { ClusterAgent } from "../../models/cluster-agent.js";
import { tagsSatisfy } from "./required-tags.js";

export type CapacityVerdict =
  /** At least one live, un-paused cluster can take it — dispatch. */
  | { kind: "capable"; agents: ClusterAgent[] }
  /** Providers exist but every one is paused or offline — wait for an operator. */
  | { kind: "all-unavailable"; reason: string }
  /** The registry is populated and nobody offers these tags — a config fault. */
  | { kind: "none-registered"; reason: string }
  /**
   * Nobody has registered at all. Boot, or a registry outage — callers FAIL OPEN
   * on this, matching the reaper's existing "registry empty → pre-claim-path
   * behaviour" and the LLM gate's cold-on-boot bias. The queue-wait bound is the
   * backstop for an open gate; refusing to dispatch here would wedge every run
   * during the seconds before the central agent registers.
   */
  | { kind: "registry-empty" };

/** Why one matching agent cannot take work right now. Paused wins: an operator
 *  turned it off, which is actionable, where offline is the reaper's own view. */
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
  const available = providers.filter(
    (agent) => !agent.paused && agent.status === "active",
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

/**
 * The detail a queue-timeout records. One writer for both of the reaper's
 * queue-timeout arms, because the graph arm and the single-CR arm were two
 * copies of one sentence, and the sentence is the whole diagnosis.
 */
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
      // The one shape a retry cannot be reasoned about from the registry: a
      // cluster that could have taken it, was up, and did not. Naming it is what
      // separates "you switched it off" from "it is stuck".
      const names = verdict.agents.map((agent) => agent.name).join(", ");
      const count = verdict.agents.length;
      const noun = count === 1 ? "cluster-agent" : "cluster-agents";
      const verb = count === 1 ? "was" : "were";

      return `${count} capable ${noun} (${names}) ${verb} active but did not claim it; it may be wedged`;
    }
  }
}
