/** The cluster surface this agent exposes: what the Kubernetes clients in `outbound` provide and what the `transport` routes call — a contract owned by neither side. */

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import type {
  AgentPodInfo,
  PodSummary,
  RunningPodInfo,
} from "@re-cinq/lore-shared";
import type { Page, PageRequest } from "@re-cinq/lore-shared/lib/paginate.js";
import type { CrdPair } from "@re-cinq/lore-shared/project/agents/agent-crd.js";

export interface ClusterDeps {
  agents: {
    get(name: string): Promise<AgentCr | null>;
    list(request: PageRequest): Promise<Page<AgentCr>>;
    remove(name: string): Promise<void>;
  };
  pods: {
    agentInfo(name: string): Promise<AgentPodInfo | null>;
    podsForJob(jobName: string): Promise<PodSummary[]>;
    podLog(podName: string, tailLines?: number): Promise<string>;
    /** Every non-terminal run pod with the agent container's resource requests — the live half of the spend page's compute-cost estimate. */
    listRunning(): Promise<RunningPodInfo[]>;
  };
  tokens: {
    cleanup(taskId: string): Promise<void>;
  };
  catalog: {
    applyPair(pair: CrdPair): Promise<void>;
    deletePair(name: string): Promise<void>;
  };
}
