/**
 * Agent execution/delegation port — the EXECUTION side (distinct from the
 * TaskStorePort record side). run() routes to local (background Claude Code),
 * cluster (LoreTask CR / claude --print), or the direct Anthropic API. The
 * routing lives in the adapter; the facade gates and delegates.
 */

export type AgentMode = "local" | "cluster" | "direct";

export interface AgentRunResult {
  taskId: string;
  mode: AgentMode;
  started: boolean;
  /** Set when a synchronous Station backend (docker) waited on the run; the
   *  caller finalizes it inline. Omitted for async backends (k8s). */
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
}

export interface AgentRunnerPort {
  run(
    repo: string,
    taskId: string,
    opts?: AgentRunOpts,
  ): Promise<AgentRunResult>;
}
