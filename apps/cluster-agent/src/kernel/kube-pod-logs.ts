// The Kubernetes half of pod-log reading, moved out of the Floor.
//
// `podLog` takes the tail at the source and returns a bounded string, which is
// what lets this sit behind a request/response API at all. The Floor keeps the
// orchestration around it (which pod is latest, what "no pod yet" means) —
// that part is pure and needs no cluster.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import {
  agentsNamespace,
  type AgentPodInfo,
  type PodSummary,
  type PodLogSource,
} from "@re-cinq/lore-shared";
import { GROUP, VERSION, AGENT_PLURAL as PLURAL } from "./crd.js";
import { coreApi, customObjectsApi } from "./kube-clients.js";
import { isNotFound } from "./k8s-errors.js";

/** Pods belonging to a Job, by the label the Job controller stamps. */
export function podSelectorForJob(jobName: string): string {
  return `job-name=${jobName}`;
}

export class KubePodLogs implements PodLogSource {
  private namespace(): string {
    return agentsNamespace();
  }

  async agentInfo(name: string): Promise<AgentPodInfo | null> {
    const api = customObjectsApi();

    try {
      const obj = (await api.getNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace(),
        plural: PLURAL,
        name,
      })) as AgentCr;

      return {
        phase: obj.status?.phase ?? null,
        jobName: obj.status?.jobName ?? null,
      };
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  async podsForJob(jobName: string): Promise<PodSummary[]> {
    const api = coreApi();
    const res = await api.listNamespacedPod({
      namespace: this.namespace(),
      labelSelector: podSelectorForJob(jobName),
    });

    return (res.items ?? []).map((pod) => ({
      name: pod.metadata?.name ?? "",
      creationTimestamp: pod.metadata?.creationTimestamp
        ? new Date(pod.metadata.creationTimestamp).toISOString()
        : undefined,
    }));
  }

  async podLog(podName: string, tailLines?: number): Promise<string> {
    const api = coreApi();

    return api.readNamespacedPodLog({
      name: podName,
      namespace: this.namespace(),
      tailLines,
    });
  }
}
