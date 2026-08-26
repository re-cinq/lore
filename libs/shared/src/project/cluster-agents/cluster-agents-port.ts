import { secretEquals } from "../../http/bearer.js";
import type { ClusterAgent } from "../../models/cluster-agent.js";

/**
 * The registry of execution clusters (FR1 of
 * specs/running-stations-in-any-k8s-cluster): who exists, what they can run,
 * and whether they are alive. Registration, identity rotation, liveness, and
 * the read side the registered-clusters page needs. Claiming station runs is
 * the station-run queue's business, not this port's — this is the roster.
 */

export interface RegisterClusterAgentInput {
  name: string;
  tags: string[];
  tokenHash: string;
  clusterInfo: Record<string, unknown> | null;
}

export interface ClusterAgentsRepository {
  findByName(name: string): Promise<ClusterAgent | null>;
  findById(id: string): Promise<ClusterAgent | null>;
  /** The auth lookup for claim/heartbeat/report calls: hash → live identity. */
  findByTokenHash(tokenHash: string): Promise<ClusterAgent | null>;
  /**
   * Null when the name was taken between the caller's decision and the
   * insert — the losing side of a concurrent first registration, which the
   * register route reports as the same 409 as any other taken name.
   */
  create(input: RegisterClusterAgentInput): Promise<ClusterAgent | null>;
  /** Token rotation + capability update for a re-registering identity. */
  rotate(id: string, input: RegisterClusterAgentInput): Promise<ClusterAgent>;
  /** Bump `last_seen_at` and revive `offline` → `active`. */
  heartbeat(id: string, at: Date): Promise<void>;
  /** Mark agents silent since `cutoff` offline; returns the newly offline. */
  markOffline(cutoff: Date): Promise<ClusterAgent[]>;
  list(): Promise<ClusterAgent[]>;
}

export type RegistrationDecision =
  { kind: "create" } | { kind: "rotate"; id: string } | { kind: "reject" };

/**
 * The identity-takeover gate: a known name re-registers only by proving it
 * already holds the identity — the current per-agent token — because the
 * shared registration token alone must never let one cluster steal another's
 * name and, with it, the runs and audit history attributed to it.
 */
export function decideRegistration(
  existing: ClusterAgent | null,
  presentedTokenHash: string | null,
): RegistrationDecision {
  if (existing === null) {
    return { kind: "create" };
  }

  if (
    presentedTokenHash !== null &&
    secretEquals(presentedTokenHash, existing.tokenHash)
  ) {
    return { kind: "rotate", id: existing.id };
  }

  return { kind: "reject" };
}
