// Live per-node pod logs, read on-demand from the cluster (never persisted).
// An assembly-line node's Agent CR (`<id8>-<nodeId>`) carries `status.jobName`;
// that Job's pod is `job-name=<jobName>`, and its stdout is the agent's live
// output (tool calls, messages, result). Logs vanish when the pod is
// garbage-collected — callers surface `available:false` rather than an error.

import {
  GROUP,
  VERSION,
  type Agent as AgentCr,
} from "@re-cinq/agent-contracts";

const PLURAL = "agents";

export interface AgentPodInfo {
  phase: string | null;
  jobName: string | null;
}

export interface PodSummary {
  name: string;
  creationTimestamp?: string;
}

/** The Kubernetes IO seam — the live impl talks to CoreV1Api/CustomObjectsApi;
 *  tests supply an in-memory double. */
export interface PodLogSource {
  /** Agent CR phase + jobName by name; null when the CR does not exist. */
  agentInfo(name: string): Promise<AgentPodInfo | null>;
  /** Pods for a Job (via the `job-name` label). */
  podsForJob(jobName: string): Promise<PodSummary[]>;
  /** A pod's logs, optionally tail-limited. */
  podLog(podName: string, tailLines?: number): Promise<string>;
}

export type AgentLogsReason = "no-agent" | "no-job" | "no-pod";

export interface AgentLogsResult {
  available: boolean;
  logs: string | null;
  phase: string | null;
  podName: string | null;
  reason?: AgentLogsReason;
}

export function podSelectorForJob(jobName: string): string {
  return `job-name=${jobName}`;
}

export function pickLatestPod(pods: readonly PodSummary[]): PodSummary | null {
  if (pods.length === 0) {
    return null;
  }

  return [...pods].sort((a, b) =>
    (b.creationTimestamp ?? "").localeCompare(a.creationTimestamp ?? ""),
  )[0];
}

/** Resolve an assembly-line node's Agent CR to its pod and read the pod's logs.
 *  Every dead-end (no CR / no job yet / pod GC'd) is a normal `available:false`
 *  result, not a throw — the pod-log lifetime is intentionally short. A pod can
 *  also be GC'd in the TOCTOU window between listing and reading, surfacing as a
 *  404; that too collapses to `no-pod`. Genuine faults (RBAC, 5xx) still throw. */
export async function readAgentLogs(
  source: PodLogSource,
  agentName: string,
  opts: { tailLines?: number } = {},
): Promise<AgentLogsResult> {
  const info = await source.agentInfo(agentName);

  if (!info) {
    return unavailable("no-agent", null);
  }

  if (!info.jobName) {
    return unavailable("no-job", info.phase);
  }

  try {
    const pod = pickLatestPod(await source.podsForJob(info.jobName));

    if (!pod) {
      return unavailable("no-pod", info.phase);
    }

    return {
      available: true,
      logs: await source.podLog(pod.name, opts.tailLines),
      phase: info.phase,
      podName: pod.name,
    };
  } catch (err) {
    if (isNotFound(err)) {
      return unavailable("no-pod", info.phase);
    }
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; response?: { statusCode?: number } };

  return e?.code === 404 || e?.response?.statusCode === 404;
}

function unavailable(
  reason: AgentLogsReason,
  phase: string | null,
): AgentLogsResult {
  return { available: false, logs: null, phase, podName: null, reason };
}

/** Live PodLogSource over @kubernetes/client-node (in-cluster config), same
 *  lazy-import pattern as KubeAgentApi. */
export class KubePodLogs implements PodLogSource {
  private namespace(): string {
    return process.env.LORE_AGENTS_NAMESPACE ?? "ai-agents";
  }

  private async kubeConfig() {
    const { KubeConfig } = await import("@kubernetes/client-node");
    const kc = new KubeConfig();

    kc.loadFromCluster();

    return kc;
  }

  private async core() {
    const { CoreV1Api } = await import("@kubernetes/client-node");

    return (await this.kubeConfig()).makeApiClient(CoreV1Api);
  }

  private async customObjects() {
    const { CustomObjectsApi } = await import("@kubernetes/client-node");

    return (await this.kubeConfig()).makeApiClient(CustomObjectsApi);
  }

  async agentInfo(name: string): Promise<AgentPodInfo | null> {
    const api = await this.customObjects();

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
      const e = err as { code?: number; response?: { statusCode?: number } };

      if (e?.code === 404 || e?.response?.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async podsForJob(jobName: string): Promise<PodSummary[]> {
    const api = await this.core();
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
    const api = await this.core();

    return api.readNamespacedPodLog({
      name: podName,
      namespace: this.namespace(),
      tailLines,
    });
  }
}
