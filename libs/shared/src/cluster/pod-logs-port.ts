// Reading a run pod's logs, as a port.
//
// Shared for the same reason the Agent CR ports are: the cluster agent
// implements it against a real Kubernetes API and the Floor consumes it over
// HTTP. `podLog` returns a bounded string rather than a stream — the tail is
// taken at the source, so this survives being a request/response call.

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
