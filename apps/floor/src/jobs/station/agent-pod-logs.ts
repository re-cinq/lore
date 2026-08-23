// Live per-node pod logs, read on-demand from the cluster (never persisted).
// An assembly-line node's Agent CR (`<id12>-<nodeId>`) carries `status.jobName`;
// that Job's pod is `job-name=<jobName>`, and its stdout is the agent's live
// output (tool calls, messages, result). Logs vanish when the pod is
// garbage-collected — callers surface `available:false` rather than an error.

// The Kubernetes half moved to the cluster agent; what stays is the pure
// orchestration — which pod is the latest, and what "no pod yet" means — plus
// the GCP archive fallback, which was never Kubernetes.
export type {
  AgentPodInfo,
  PodSummary,
  PodLogSource,
} from "@re-cinq/lore-shared";
import { agentsNamespace } from "@re-cinq/lore-shared";
import type { PodSummary, PodLogSource } from "@re-cinq/lore-shared";

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
  constructor(private readonly namespace = agentsNamespace()) {}

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
