// Reading a run pod's logs, as a port — shared like the Agent CR ports (cluster-agent implements against real Kubernetes, Floor consumes over HTTP); podLog returns a bounded tail string, not a stream.

export interface AgentPodInfo {
  phase: string | null;
  jobName: string | null;
}

export interface PodSummary {
  name: string;
  creationTimestamp?: string;
}

/** One live run pod as the compute-cost estimator needs it: identity, start time, and resource REQUESTS (not usage — requests size the node the autoscaler bills for), plus run-correlation labels. */
export interface RunningPodInfo {
  name: string;
  phase: string;
  startedAt: string | null;
  requests: Record<string, string>;
  labels: Record<string, string>;
}

/** The Kubernetes IO seam — the live impl talks to CoreV1Api/CustomObjectsApi; tests supply an in-memory double. */
export interface PodLogSource {
  /** Agent CR phase + jobName by name; null when the CR does not exist. */
  agentInfo(name: string): Promise<AgentPodInfo | null>;
  /** Pods for a Job (via the `job-name` label). */
  podsForJob(jobName: string): Promise<PodSummary[]>;
  /** A pod's logs, optionally tail-limited. */
  podLog(podName: string, tailLines?: number): Promise<string>;
}
