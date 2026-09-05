/** The cluster surface this agent exposes: what kernel's Kubernetes clients provide and what the delivery routes call. The contract lives in kernel because kernel implements it — declaring it in the route made the substrate import its own caller. */

import type {
  Agent as AgentCr,
  AgentDefinition,
  Station,
} from "@re-cinq/agent-contracts";
import type {
  AgentPodInfo,
  PodSummary,
  RunningPodInfo,
} from "@re-cinq/lore-shared";

export interface ClusterDeps {
  agents: {
    get(name: string): Promise<AgentCr | null>;
    list(opts: {
      labelSelector?: string;
      limit: number;
      continue?: string;
    }): Promise<{ items: AgentCr[]; continueToken?: string }>;
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
    applyPair(pair: {
      agentDefinition: AgentDefinition;
      station: Station;
    }): Promise<void>;
    deletePair(name: string): Promise<void>;
  };
}
