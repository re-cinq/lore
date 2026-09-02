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
  type RunningPodInfo,
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

  async listRunning(): Promise<RunningPodInfo[]> {
    const api = coreApi();
    const res = await api.listNamespacedPod({ namespace: this.namespace() });

    return (res.items ?? [])
      .filter(
        (pod) =>
          pod.status?.phase === "Running" || pod.status?.phase === "Pending",
      )
      .map((pod) => {
        // The AGENT container's requests are the cost driver; init containers
        // finish before the bill starts and sidecars this stack does not run.
        const agent =
          pod.spec?.containers?.find((c) => c.name === "agent") ??
          pod.spec?.containers?.[0];
        const labels: Record<string, string> = {};

        for (const [k, v] of Object.entries(pod.metadata?.labels ?? {})) {
          if (k.startsWith("lore.re-cinq.com/") || k === "job-name") {
            labels[k] = v;
          }
        }

        return {
          name: pod.metadata?.name ?? "",
          phase: pod.status?.phase ?? "",
          startedAt: pod.status?.startTime
            ? new Date(pod.status.startTime).toISOString()
            : null,
          requests: { ...(agent?.resources?.requests ?? {}) } as Record<
            string,
            string
          >,
          labels,
        };
      });
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
