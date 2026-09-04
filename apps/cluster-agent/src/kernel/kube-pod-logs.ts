// The Kubernetes half of pod-log reading, moved out of the Floor. `podLog` takes the tail at the source and returns a bounded string; the pure orchestration around it stays on the Floor.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import type { V1Pod } from "@kubernetes/client-node";
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

// The AGENT container's requests are the cost driver — init containers finish before the bill starts and this stack runs no sidecars.
function agentContainer(pod: V1Pod) {
  return (
    pod.spec?.containers?.find((container) => container.name === "agent") ??
    pod.spec?.containers?.[0]
  );
}

// Only Lore's own labels + the Job-controller label are surfaced; everything else on the pod is noise.
function podLabels(pod: V1Pod): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const [key, value] of Object.entries(pod.metadata?.labels ?? {})) {
    if (key.startsWith("lore.re-cinq.com/") || key === "job-name") {
      labels[key] = value;
    }
  }

  return labels;
}

function isLiveRunningPod(pod: V1Pod): boolean {
  return pod.status?.phase === "Running" || pod.status?.phase === "Pending";
}

function toRunningPodInfo(pod: V1Pod): RunningPodInfo {
  const agent = agentContainer(pod);

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
    labels: podLabels(pod),
  };
}

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
      const agent = (await api.getNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace(),
        plural: PLURAL,
        name,
      })) as AgentCr;

      return {
        phase: agent.status?.phase ?? null,
        jobName: agent.status?.jobName ?? null,
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

    return (res.items ?? []).filter(isLiveRunningPod).map(toRunningPodInfo);
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
