// Agent execution/delegation port (execution side, distinct from TaskStorePort's record side); run() routes to local/cluster/direct, routing lives in the adapter, the facade gates and delegates.

export type AgentMode = "local" | "cluster" | "direct";

export interface AgentRunResult {
  taskId: string;
  mode: AgentMode;
  started: boolean;
  /** Set when dispatch joined a run already working this subject; the task owns no run of its own, the caller must settle it. */
  joinedRun?: string;
  /** Set when a synchronous Station backend (docker) waited on the run, for inline finalize; omitted for async backends (k8s). */
  completion?: import("./station-port.js").StationCompletion;
}

export interface AgentRunOpts {
  mode?: AgentMode;
  prompt?: string;
  workDir?: string;
  model?: string;
  branch?: string;
  taskType?: string;
  description?: string;
  // cluster-mode CR extras
  timeoutMinutes?: number;
  prNumber?: number;
  name?: string;
  extraLabels?: Record<string, string>;
  darkFactory?: { workflowName: string; baseBranch: string };
  /** BYO execution container (ADR-025); omitted → controller default. */
  image?: string;
  /** Feature a planning run belongs to, threaded into the line's args so a definition can key a conversation thread on args.feature_id. */
  featureId?: string;
  /** Round's feedback-only turn, used instead of description when the run resumes a conversation. */
  roundFeedback?: string;
  /** The task whose run this one continues (rewind). */
  resumeFromTask?: string;
  /** Seed values for the assembly run's `args` (implementation-loop FR11). */
  lineArgs?: Record<string, unknown>;
}

export interface AgentRunnerPort {
  run(
    repo: string,
    taskId: string,
    opts?: AgentRunOpts,
  ): Promise<AgentRunResult>;
}
