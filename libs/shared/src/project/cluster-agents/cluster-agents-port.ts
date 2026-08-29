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
  /** Update a live identity's tags, cluster info and token hash in place. The
   *  hash is normally the one it already carries — a re-registration by the
   *  holder keeps its credential (a rotation there cuts off its own running
   *  pods) — so this refreshes the row rather than issuing anything. */
  refresh(id: string, input: RegisterClusterAgentInput): Promise<ClusterAgent>;
  /** Bump `last_seen_at` and revive `offline` → `active`. */
  heartbeat(id: string, at: Date): Promise<void>;
  /**
   * The operator's stop switch: a paused agent is passed over when work is
   * handed out, while staying alive and finishing what it already holds.
   * Returns the updated row, or null when no such agent exists.
   */
  setPaused(id: string, paused: boolean): Promise<ClusterAgent | null>;
  /** Mark agents silent since `cutoff` offline; returns the newly offline. */
  markOffline(cutoff: Date): Promise<ClusterAgent[]>;
  list(): Promise<ClusterAgent[]>;
}

export type RegistrationDecision =
  | { kind: "create" }
  | { kind: "refresh"; id: string; tokenHash: string }
  | { kind: "reject" };

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
    return {
      kind: "refresh",
      id: existing.id,
      tokenHash: existing.tokenHash,
    };
  }

  return { kind: "reject" };
}
