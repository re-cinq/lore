// The cluster operations, as ports.
//
// Both sides need these declarations now: the cluster agent IMPLEMENTS them
// against a real Kubernetes API, and the Floor CONSUMES them through HTTP
// adapters. They were declared inside the Floor's dispatch module, which is
// exactly where a port cannot live once a second process implements it.
//
// Deliberately domain operations, not Kubernetes verbs. Three of the underlying
// interactions are read-modify-write pairs — the status subresource, the Secret
// key, the catalog apply — and a port that exposed `get` and `replace`
// separately would invite a caller to split a pair across the network and lose
// the update.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import type { AgentNodeStatus } from "./agent-node-status.js";
import type { LoreTaskSpec } from "../project/agents/k8s-port.js";

/** Creating and reading this cluster's Agent CRs. */
export interface AgentApi {
  /** Create the Agent; `created:false` when it already exists (409). */
  create(agent: AgentCr): Promise<{ name: string; created: boolean }>;
  /** Agents matching a Kubernetes label selector. */
  listByLabel(selector: string): Promise<AgentCr[]>;
}

/** Reading one Agent's terminal status. */
export interface AgentStatusReader {
  getStatus(name: string): Promise<AgentNodeStatus | null>;
}

/** The per-task GitHub token + catalog clone an agent pod needs to run.
 *  Returns the per-task Station name, or undefined when the recipe is absent. */
export interface TokenProvisioner {
  provision(spec: LoreTaskSpec): Promise<string | undefined>;
}

/** Reclaiming what `provision` created. Best-effort and idempotent. */
export interface TokenCleanup {
  cleanup(taskId: string): Promise<void>;
}
