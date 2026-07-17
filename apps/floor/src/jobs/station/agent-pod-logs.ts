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
import { loadKube } from "@re-cinq/lore-shared";

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
  /** true when the logs came from the durable archive (Cloud Logging), not a
   *  live pod — the pod was already garbage-collected. */
  archived?: boolean;
}

/** The durable-log seam: a finished node's stdout, read back from a store that
 *  outlives the pod (Cloud Logging). Consulted only once the live pod is gone. */
export interface PodLogArchive {
  /** Retained stdout for a Job's pod, or null when nothing is retained. */
  logsForJob(
    jobName: string,
    opts?: { tailLines?: number },
  ): Promise<string | null>;
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
  archive?: PodLogArchive,
): Promise<AgentLogsResult> {
  const info = await source.agentInfo(agentName);

  if (!info) {
    return unavailable("no-agent", null);
  }

  const jobName = info.jobName;

  if (!jobName) {
    return unavailable("no-job", info.phase);
  }

  try {
    const pod = pickLatestPod(await source.podsForJob(jobName));

    if (!pod) {
      return archivedOrNoPod(jobName, info.phase, opts, archive);
    }

    return {
      available: true,
      logs: await source.podLog(pod.name, opts.tailLines),
      phase: info.phase,
      podName: pod.name,
    };
  } catch (err) {
    if (isNotFound(err)) {
      return archivedOrNoPod(jobName, info.phase, opts, archive);
    }
    throw err;
  }
}

/** The pod is gone. Serve the durable archive if it has anything retained,
 *  otherwise report `no-pod` as before. */
async function archivedOrNoPod(
  jobName: string,
  phase: string | null,
  opts: { tailLines?: number },
  archive: PodLogArchive | undefined,
): Promise<AgentLogsResult> {
  const logs = archive ? await archive.logsForJob(jobName, opts) : null;

  if (logs === null) {
    return unavailable("no-pod", phase);
  }

  return { available: true, logs, phase, podName: null, archived: true };
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

/** Live PodLogSource over @kubernetes/client-node, same lazy-import pattern as
 *  KubeAgentApi. */
export class KubePodLogs implements PodLogSource {
  private namespace(): string {
    return process.env.LORE_AGENTS_NAMESPACE ?? "ai-agents";
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
export interface LogEntry {
  textPayload?: string;
  jsonPayload?: { message?: string } & Record<string, unknown>;
}

const DEFAULT_ARCHIVE_LINES = 5000;
const LOGGING_ENTRIES_URL = "https://logging.googleapis.com/v2/entries:list";
const LOGGING_READ_SCOPE = "https://www.googleapis.com/auth/logging.read";

/** The stdout line for one entry: raw payload, else the structured message,
 *  else the structured payload as JSON. */
export function entryText(entry: LogEntry): string {
  if (typeof entry.textPayload === "string") {
    return entry.textPayload;
  }

  if (typeof entry.jsonPayload?.message === "string") {
    return entry.jsonPayload.message;
  }

  return entry.jsonPayload ? JSON.stringify(entry.jsonPayload) : "";
}

/** Cloud Logging filter selecting one Job's container logs in a namespace. */
export function podLogFilter(namespace: string, jobName: string): string {
  return [
    `resource.type="k8s_container"`,
    `resource.labels.namespace_name="${namespace}"`,
    `labels."k8s-pod/job-name"="${jobName}"`,
  ].join(" ");
}

/** Entries arrive newest-first (orderBy timestamp desc) — reverse to
 *  chronological order and join. null when the archive holds nothing. */
export function assembleArchivedLog(entries: LogEntry[]): string | null {
  if (entries.length === 0) {
    return null;
  }

  return entries.map(entryText).reverse().join("\n");
}

/** PodLogArchive backed by GCP Cloud Logging (the `_Default` log bucket, where
 *  GKE ships every pod's stdout and retains it long after the pod is GC-ed).
 *  Auth via Workload Identity (ADC); any failure degrades to null so the
 *  agent-logs endpoint never 500s on a logging hiccup. */
export class CloudLoggingPodLogs implements PodLogArchive {
  constructor(
    private readonly namespace = process.env.LORE_AGENTS_NAMESPACE ??
      "ai-agents",
  ) {}

  async logsForJob(
    jobName: string,
    opts: { tailLines?: number } = {},
  ): Promise<string | null> {
    try {
      const { GoogleAuth } = await import("google-auth-library");
      const auth = new GoogleAuth({ scopes: LOGGING_READ_SCOPE });
      const [projectId, client] = await Promise.all([
        auth.getProjectId(),
        auth.getClient(),
      ]);
      const res = await client.request<{ entries?: LogEntry[] }>({
        url: LOGGING_ENTRIES_URL,
        method: "POST",
        data: {
          resourceNames: [`projects/${projectId}`],
          filter: podLogFilter(this.namespace, jobName),
          orderBy: "timestamp desc",
          pageSize: opts.tailLines ?? DEFAULT_ARCHIVE_LINES,
        },
      });

      return assembleArchivedLog(res.data.entries ?? []);
    } catch {
      return null;
    }
  }
}
