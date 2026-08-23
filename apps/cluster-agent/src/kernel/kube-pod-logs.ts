// The Kubernetes half of pod-log reading, moved out of the Floor.
//
// `podLog` takes the tail at the source and returns a bounded string, which is
// what lets this sit behind a request/response API at all. The Floor keeps the
// orchestration around it (which pod is latest, what "no pod yet" means) —
// that part is pure and needs no cluster.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import {
  agentsNamespace,
  loadKube,
  type AgentPodInfo,
  type PodSummary,
  type PodLogSource,
} from "@re-cinq/lore-shared";

/** Pods belonging to a Job, by the label the Job controller stamps. */
function podSelectorForJob(jobName: string): string {
  return `job-name=${jobName}`;
}

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";

export class KubePodLogs implements PodLogSource {
  private namespace(): string {
    return agentsNamespace();
  }

  private async kubeConfig() {
    const { KubeConfig } = await import("@kubernetes/client-node");
    const kc = new KubeConfig();

    loadKube(kc);

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

/** One Cloud Logging entry — a container log line is either a raw `textPayload`
 *  or a structured `jsonPayload` (agents that log JSON). */
