// The cluster operations, as ports.
//
// Both sides need these declarations now: the cluster agent IMPLEMENTS them
// against a real Kubernetes API, and the Floor CONSUMES them through HTTP
// adapters. They were declared inside the Floor's dispatch module, which is
// exactly where a port cannot live once a second process implements it.
//
// Deliberately domain operations, not Kubernetes verbs. Two of the underlying
// interactions are read-modify-write pairs — the Secret key write and the
// catalog apply — and a port that exposed `get` and `replace` separately would
// invite a caller to split a pair across the network and lose the update.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import type { AgentNodeStatus } from "./agent-node-status.js";
import type { LoreTaskSpec } from "../project/agents/k8s-port.js";

/**
 * Finding this cluster's Agent CRs.
 *
 * Split from {@link AgentApi} because reading and creating stopped being the
 * same privilege. Since dispatch went pull-only, only the process INSIDE a
 * cluster creates CRs there — for runs it claimed itself. Everyone else (the
 * Floor's reaper, its reconcile pass, the liveness probe) only ever looks, and
 * a port that offered them `create` would be offering a push path that no
 * longer has a route behind it.
 */
export interface AgentLister {
  /** Agents matching a Kubernetes label selector. */
  listByLabel(selector: string): Promise<AgentCr[]>;
}

/** Creating and reading this cluster's Agent CRs — implemented only by the
 *  in-cluster adapter, whose claim loop is the sole creator. */
export interface AgentApi extends AgentLister {
  /** Create the Agent; `created:false` when it already exists (409). */
  create(agent: AgentCr): Promise<{ name: string; created: boolean }>;
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
