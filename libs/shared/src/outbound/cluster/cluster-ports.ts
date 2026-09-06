// Cluster ops as ports: cluster agent implements against real k8s, Floor consumes via HTTP.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import type { AgentNodeStatus } from "./agent-node-status.js";
import type { LoreTaskSpec } from "../project/agents/k8s-port.js";

// Split from AgentApi: since dispatch went pull-only, only the in-cluster process creates CRs; everyone else only lists.
export interface AgentLister {
  listByLabel(selector: string): Promise<AgentCr[]>;
}

export interface AgentApi extends AgentLister {
  create(agent: AgentCr): Promise<{ name: string; created: boolean }>;
}

export interface AgentStatusReader {
  getStatus(name: string): Promise<AgentNodeStatus | null>;
}

export interface TokenProvisioner {
  provision(spec: LoreTaskSpec): Promise<string | undefined>;
}

export interface TokenCleanup {
  cleanup(taskId: string): Promise<void>;
}
