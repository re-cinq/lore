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
  redactSecrets,
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

/** Why a failed Agent's pod died, in its own words — the Job-level `BackoffLimitExceeded` the CR carries says only that it did. Undefined when the pod offers nothing more concrete, so the caller keeps the Job reason and its classification rather than trading it for a bare exit code. */
export function podFailureCause(pod: V1Pod, log: string): string | undefined {
  const ended = endedContainer(pod);

  if (!ended) {
    return undefined;
  }

  return ended.reason === "OOMKilled"
    ? `${ended.label} was OOMKilled (exit ${ended.exitCode})`
    : causeFromLog(ended, log);
}

function causeFromLog(ended: EndedContainer, log: string): string | undefined {
  const lines = plainCauseLines(log);

  return lines.length === 0
    ? undefined
    : redactSecrets(
        `${ended.label} exited ${ended.exitCode}: ${lines.join(" ")}`,
      );
}

// The step runner echoes the whole command it ran after the step's own output; git's words say why, the echo only says what.
const STEP_COMMAND_ECHO = /^\[\w+\] .+ failed \(exit \d+\):/;
const CAUSE_LINES = 3;

/** The log's last plain lines: lifecycle markers and stream-json are the runner talking, not the failing program. */
function plainCauseLines(log: string): string[] {
  return log
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("{"))
    .filter((line) => !STEP_COMMAND_ECHO.test(line))
    .slice(-CAUSE_LINES);
}

interface EndedContainer {
  name: string;
  label: string;
  exitCode: number;
  reason?: string;
}

/** The container that ended the pod badly: a failed init container first, since `agent` never starts after one. */
function endedContainer(pod: V1Pod): EndedContainer | undefined {
  return (
    endedIn("init container", pod.status?.initContainerStatuses) ??
    endedIn("container", pod.status?.containerStatuses)
  );
}

function endedIn(
  kind: string,
  statuses: V1ContainerStatus[] = [],
): EndedContainer | undefined {
  const ended = statuses.find(endedBadly);

  return ended && describeEnded(kind, ended);
}

function describeEnded(
  kind: string,
  status: V1ContainerStatus,
): EndedContainer {
  const terminated = status.state?.terminated;

  return {
    name: status.name,
    label: `${kind} "${status.name}"`,
    exitCode: terminated?.exitCode ?? 0,
    reason: terminated?.reason,
  };
}

const FAILURE_LOG_TAIL_LINES = 40;

function byCreationDescending(a: V1Pod, b: V1Pod): number {
  return creationMillis(b) - creationMillis(a);
}

function creationMillis(pod: V1Pod): number {
  const created = pod.metadata?.creationTimestamp;

  return created ? new Date(created).getTime() : 0;
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

  /** Why a failed Agent's Job died, read off its newest pod — a Job's retry pods are older attempts, not the one the CR's phase reports. */
  async failureCause(jobName: string): Promise<string | undefined> {
    const api = this.api();
    const { items: pods } = await api.listNamespacedPod({
      namespace: this.namespace(),
      labelSelector: podSelectorForJob(jobName),
    });
    const newest = pods.toSorted(byCreationDescending).at(0);

    if (!newest) {
      return undefined;
    }
    const log = await api.readNamespacedPodLog({
      name: podName(newest),
      namespace: this.namespace(),
      tailLines: FAILURE_LOG_TAIL_LINES,
      container: endedContainer(newest)?.name,
    });

    return podFailureCause(newest, log);
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
