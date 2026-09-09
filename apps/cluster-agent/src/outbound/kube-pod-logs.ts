// The Kubernetes half of pod-log reading, moved out of the Floor. `podLog` takes the tail at the source and returns a bounded string; the pure orchestration around it stays on the Floor.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import type {
  CoreV1Api,
  V1Container,
  V1ContainerStatus,
  V1Pod,
} from "@kubernetes/client-node";
import {
  agentsNamespace,
  type AgentPodInfo,
  type PodSummary,
  type PodLogSource,
  type RunningPodInfo,
} from "@re-cinq/lore-shared";
import { GROUP, VERSION, AGENT_PLURAL as PLURAL } from "../domain/crd.js";
import { coreApi, customObjectsApi } from "./kube-clients.js";
import { isMissing } from "../lib/k8s-errors.js";

function isLiveRunningPod(pod: V1Pod): boolean {
  return pod.status?.phase === "Running" || pod.status?.phase === "Pending";
}

function toRunningPodInfo(pod: V1Pod): RunningPodInfo {
  return {
    name: podName(pod),
    phase: podPhase(pod),
    startedAt: podStartedAt(pod),
    requests: agentRequests(agentContainer(pod)),
    labels: podLabels(pod),
  };
}

function podName(pod: V1Pod): string {
  return pod.metadata?.name ?? "";
}

function podPhase(pod: V1Pod): string {
  return pod.status?.phase ?? "";
}

function podStartedAt(pod: V1Pod): string | null {
  return pod.status?.startTime
    ? new Date(pod.status.startTime).toISOString()
    : null;
}

function agentRequests(
  agent: ReturnType<typeof agentContainer>,
): Record<string, string> {
  return { ...(agent?.resources?.requests ?? {}) } as Record<string, string>;
}

// The AGENT container's requests are the cost driver — init containers finish before the bill starts and this stack runs no sidecars.
function agentContainer(pod: V1Pod): V1Container | undefined {
  const containers = pod.spec?.containers ?? [];

  return (
    containers.find((container) => container.name === "agent") ?? containers[0]
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

/** Pods belonging to a Job, by the label the Job controller stamps. */
export function podSelectorForJob(jobName: string): string {
  return `job-name=${jobName}`;
}

/** The init container that ended the pod, if one did. A pod whose init fails never starts `agent`, so asking for the default container answers `BadRequest: container "agent" is waiting to start` — and the one line saying WHY the run died (a checkout of a branch that is gone, an unreachable skills registry) is unreadable from every Lore surface. That is how a deterministic failure got reported as retryable `infra` ("re-running is the right response") and was re-run for ten days. */
export function failedInitContainer(pod: V1Pod): string | undefined {
  const failed = (pod.status?.initContainerStatuses ?? []).find(endedBadly);

  return failed?.name;
}

/** An init container that ran and did not exit 0. One still running has no `terminated` and is not it. */
function endedBadly(status: V1ContainerStatus): boolean {
  const terminated = status.state?.terminated;

  return terminated !== undefined && terminated.exitCode !== 0;
}

function agentPodInfoOf(agent: AgentCr): AgentPodInfo {
  return {
    phase: agent.status?.phase ?? null,
    jobName: agent.status?.jobName ?? null,
  };
}

export class KubePodLogs implements PodLogSource {
  // Injected like KubeAgentApi's, so the log-container choice is testable without an apiserver — without a seam here the only test that could exist would talk to the live cluster.
  constructor(private readonly api: () => CoreV1Api = coreApi) {}

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

      return agentPodInfoOf(agent);
    } catch (err) {
      if (isMissing(err)) {
        return null;
      }
      throw err;
    }
  }

  async podsForJob(jobName: string): Promise<PodSummary[]> {
    const api = this.api();
    const res = await api.listNamespacedPod({
      namespace: this.namespace(),
      labelSelector: podSelectorForJob(jobName),
    });

    return res.items.map((pod) => ({
      name: pod.metadata?.name ?? "",
      creationTimestamp: pod.metadata?.creationTimestamp
        ? new Date(pod.metadata.creationTimestamp).toISOString()
        : undefined,
    }));
  }

  async listRunning(): Promise<RunningPodInfo[]> {
    const api = this.api();
    const res = await api.listNamespacedPod({ namespace: this.namespace() });

    const { items: pods } = res;

    return pods.filter(isLiveRunningPod).map(toRunningPodInfo);
  }

  // Reads whichever container actually ran: a failed init container when there is one, the default (`agent`) otherwise. Which one that is, is a fact about the pod, so it is decided here rather than asked of every caller.
  async podLog(podName: string, tailLines?: number): Promise<string> {
    const api = this.api();
    const pod = await api.readNamespacedPod({
      name: podName,
      namespace: this.namespace(),
    });

    return api.readNamespacedPodLog({
      name: podName,
      namespace: this.namespace(),
      tailLines,
      container: failedInitContainer(pod),
    });
  }
}
