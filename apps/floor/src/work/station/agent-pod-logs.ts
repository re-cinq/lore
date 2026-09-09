// Live per-node pod logs read on-demand from the cluster (never persisted); vanish on pod GC, so callers see `available:false`, not an error.
export type {
  AgentPodInfo,
  PodSummary,
  PodLogSource,
} from "@re-cinq/lore-shared";
import { agentsNamespace } from "@re-cinq/lore-shared";
import type { PodLogArchiveLike } from "@re-cinq/lore-shared/project/pod-logs/stored-pod-log-archive.js";
import type { PodSummary, PodLogSource } from "@re-cinq/lore-shared";

export type AgentLogsReason = "no-agent" | "no-job" | "no-pod";

export interface AgentLogsResult {
  available: boolean;
  logs: string | null;
  phase: string | null;
  podName: string | null;
  reason?: AgentLogsReason;
  /** true when logs came from the durable archive (Cloud Logging), not a live pod. */
  archived?: boolean;
}

/** The durable-log seam: a finished node's stdout, read back once the live pod is gone. */
export type PodLogArchive = PodLogArchiveLike;

/** Whether the live source may be asked about this CR at all; false for a run claimed by a cluster the source cannot see (#1627). */
export type LiveReadable = (agentName: string) => Promise<boolean>;

export interface ReadAgentLogsOptions {
  tailLines?: number;
  /** Defaults to always live — the pre-satellite behaviour. */
  liveReadable?: LiveReadable;
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

/** Resolve an Agent CR to its pod and read logs; every dead-end (no CR/job/pod, or a TOCTOU 404) collapses to `available:false`, not a throw — genuine faults (RBAC, 5xx) still throw. */
export async function readAgentLogs(
  source: PodLogSource,
  agentName: string,
  { liveReadable = alwaysLive, ...opts }: ReadAgentLogsOptions = {},
  archive?: PodLogArchive,
): Promise<AgentLogsResult> {
  if (!(await liveReadable(agentName))) {
    return archivedForAgent(agentName, opts, archive);
  }
  const agent = await source.agentInfo(agentName);

  // A CR we were allowed to ask for and did not find is pruned (the retention reap, #1673) or was never ours — neither means the agent produced nothing, and the archive is keyed by CR name precisely for this.
  if (!agent) {
    return archivedForAgent(agentName, opts, archive, "no-agent");
  }

  const jobName = agent.jobName;

  if (!jobName) {
    return unavailable("no-job", agent.phase);
  }

  return readJobPodLogs({ source, jobName, phase: agent.phase, opts, archive });
}

const alwaysLive: LiveReadable = async () => true;

/** A CR this Floor cannot ask (or asked for and did not find) has no Job name to key on, so the archive is read by the CR name the pod-log ingest stored beside it; no phase, since the CR was never read. `emptyReason` is what to report when the archive holds nothing either — the caller knows whether the CR was unreachable or absent, and that distinction is the whole point. */
async function archivedForAgent(
  agentName: string,
  opts: { tailLines?: number },
  archive: PodLogArchive | undefined,
  emptyReason: AgentLogsReason = "no-pod",
): Promise<AgentLogsResult> {
  const logs = (await archive?.logsForAgent?.(agentName, opts)) ?? null;

  return archivedOrUnavailable(logs, null, emptyReason);
}

interface ReadJobPodLogsParams {
  source: PodLogSource;
  jobName: string;
  phase: string | null;
  opts: { tailLines?: number };
  archive: PodLogArchive | undefined;
}

/** Reads the job's latest pod's logs, falling back to the archive on a missing pod or a TOCTOU 404. */
async function readJobPodLogs(
  params: ReadJobPodLogsParams,
): Promise<AgentLogsResult> {
  const { jobName, phase, opts, archive } = params;

  try {
    return (
      (await readLivePodLogs(params)) ??
      (await archivedOrNoPod(jobName, phase, opts, archive))
    );
  } catch (err) {
    if (isMissing(err)) {
      return archivedOrNoPod(jobName, phase, opts, archive);
    }
    throw err;
  }
}

/** The live pod's stdout, or null when the job has no pod left to read. */
async function readLivePodLogs({
  source,
  jobName,
  phase,
  opts,
}: ReadJobPodLogsParams): Promise<AgentLogsResult | null> {
  const pod = pickLatestPod(await source.podsForJob(jobName));

  if (!pod) {
    return null;
  }

  return {
    available: true,
    logs: await source.podLog(pod.name, opts.tailLines),
    phase,
    podName: pod.name,
  };
}

/** The pod is gone; serve the durable archive if it has anything, else report `no-pod`. */
async function archivedOrNoPod(
  jobName: string,
  phase: string | null,
  opts: { tailLines?: number },
  archive: PodLogArchive | undefined,
): Promise<AgentLogsResult> {
  const logs = archive ? await archive.logsForJob(jobName, opts) : null;

  return archivedOrUnavailable(logs, phase);
}

function archivedOrUnavailable(
  logs: string | null,
  phase: string | null,
  emptyReason: AgentLogsReason = "no-pod",
): AgentLogsResult {
  if (logs === null) {
    return unavailable(emptyReason, phase);
  }

  return { available: true, logs, phase, podName: null, archived: true };
}

function isMissing(err: unknown): boolean {
  const e = err as { code?: number; response?: { statusCode?: number } };

  return e.code === 404 || e.response?.statusCode === 404;
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

/** The stdout line for one entry: raw payload, else structured message, else structured payload as JSON. */
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

/** Entries arrive newest-first (orderBy timestamp desc) — reverse to chronological order and join. */
export function assembleArchivedLog(entries: LogEntry[]): string | null {
  if (entries.length === 0) {
    return null;
  }

  return entries.map(entryText).reverse().join("\n");
}

/** PodLogArchive backed by GCP Cloud Logging (`_Default` bucket); auth via Workload Identity, any failure degrades to null so the endpoint never 500s. */
export class CloudLoggingPodLogs implements PodLogArchive {
  constructor(private readonly namespace = agentsNamespace()) {}

  async logsForJob(
    jobName: string,
    opts: { tailLines?: number } = {},
  ): Promise<string | null> {
    try {
      const entries = await fetchLogEntries(
        podLogFilter(this.namespace, jobName),
        opts.tailLines ?? DEFAULT_ARCHIVE_LINES,
      );

      return assembleArchivedLog(entries);
    } catch {
      return null;
    }
  }
}

/** One `entries:list` call against Cloud Logging, authenticated by Workload Identity. */
async function fetchLogEntries(
  filter: string,
  pageSize: number,
): Promise<LogEntry[]> {
  const { projectId, client } = await loggingClient();
  const res = await client.request<{ entries?: LogEntry[] }>({
    url: LOGGING_ENTRIES_URL,
    method: "POST",
    data: {
      resourceNames: [`projects/${projectId}`],
      filter,
      orderBy: "timestamp desc",
      pageSize,
    },
  });

  return res.data.entries ?? [];
}

/** The Workload-Identity-authenticated client plus the project the entries are read from. */
async function loggingClient() {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: LOGGING_READ_SCOPE });
  const [projectId, client] = await Promise.all([
    auth.getProjectId(),
    auth.getClient(),
  ]);

  return { projectId, client };
}
