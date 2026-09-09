import { secretEquals } from "../../../lib/secret-equals.js";
import type { ClusterAgent } from "../../../domain/models/cluster-agent.js";

/** The registry of execution clusters (FR1 specs/running-stations-in-any-k8s-cluster): who exists, what they can run, liveness. */

/** Which way the operator switch is thrown. */
export type PauseState = "paused" | "running";

export interface RegisterClusterAgentInput {
  name: string;
  tags: string[];
  tokenHash: string;
  clusterInfo: Record<string, unknown> | null;
}

export interface ClusterAgentsRepository {
  findByName(name: string): Promise<ClusterAgent | null>;
  findById(id: string): Promise<ClusterAgent | null>;
  findByTokenHash(tokenHash: string): Promise<ClusterAgent | null>;
  /** Null when name taken between decision and insert (losing side of concurrent registration). */
  create(input: RegisterClusterAgentInput): Promise<ClusterAgent | null>;
  /** Update tags, cluster info, token hash; re-registration keeps its credential. */
  refresh(id: string, input: RegisterClusterAgentInput): Promise<ClusterAgent>;
  heartbeat(id: string, at: Date): Promise<void>;
  /** The operator's stop switch: a paused agent is passed over but stays alive, finishing existing work. */
  setPaused(id: string, state: PauseState): Promise<ClusterAgent | null>;
  /** Mark agents silent since `cutoff` offline; returns the newly offline. */
  markOffline(cutoff: Date): Promise<ClusterAgent[]>;
  list(): Promise<ClusterAgent[]>;
  /** Advance `lore.catalog_events` high-water mark: monotonic (GREATEST) to prevent tail replay. */
  advanceCatalogCursor(id: string, cursor: string): Promise<void>;
}

export type RegistrationDecision =
  | { kind: "create" }
  | { kind: "refresh"; id: string; tokenHash: string }
  | { kind: "reject" };

/** Identity-takeover gate: re-register by proving current per-agent token, not the shared token. */
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
